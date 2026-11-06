// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouter} from "../src/PaymentRouter.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {Base} from "./Base.t.sol";
import {MockHook, ReentrantHook} from "./mocks/MockHook.sol";
import {MockWallet} from "./mocks/MockWallet.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract RevertingReputation {
    function record(address, uint128, bool) external pure {
        revert("nope");
    }
}

contract GasBurnerReputation {
    function record(address, uint128, bool) external pure {
        while (true) {}
    }
}

contract PaymentRouterTest is Base {
    bytes32 internal constant REF1 = keccak256("INV-1");
    bytes32 internal constant REF2 = keccak256("INV-2");
    bytes32 internal constant S1 = keccak256("salt-1");
    bytes32 internal constant S2 = keccak256("salt-2");

    // ================================================================ constructor

    function test_constructor_setsConfig() public view {
        assertEq(address(router.usdt()), address(usdt));
        assertEq(router.owner(), owner);
        assertEq(router.guardian(), guardian);
        assertEq(router.attester(), attester);
        assertEq(router.refundApprovalThreshold(), THRESHOLD);
    }

    function test_constructor_zeroAddressesRevert() public {
        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        new PaymentRouter(address(0), owner, guardian, attester, THRESHOLD);
        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        new PaymentRouter(address(usdt), owner, address(0), attester, THRESHOLD);
        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        new PaymentRouter(address(usdt), owner, guardian, address(0), THRESHOLD);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PaymentRouter(address(usdt), address(0), guardian, attester, THRESHOLD);
    }

    // ================================================================ pure helpers

    function test_ids_areMerchantScoped() public view {
        assertTrue(router.invoiceIdOf(merchant, REF1) != router.invoiceIdOf(payer, REF1));
        assertTrue(router.invoiceIdOf(merchant, REF1) != router.invoiceIdOf(merchant, REF2));
        assertEq(router.invoiceIdOf(merchant, REF1), keccak256(abi.encode(merchant, REF1)));
    }

    /// @dev The same constants are asserted in packages/shared/test/ids.test.ts, computed independently with `cast`.
    function test_ids_matchSharedPackageVectors() public view {
        address m = 0x50c94c3021962047F10c9c58D80C4A7b73182a63;
        bytes32 ref = keccak256("INV-1");
        bytes32 id = router.invoiceIdOf(m, ref);
        assertEq(ref, 0x80066d42cb1d1876d3f91ddfce739f4649eb223e815f12756f733eb185548803);
        assertEq(id, 0x9ef5cc50eed76dda0d467227d32f719840fdc30d278ccee49088083624704f1b);
        assertEq(
            router.payNonce(id, keccak256("salt-1")), 0x30c0821dae3ef5dfd5e9a46e71ce92f134ddac0b8e6be8fa3745d8e8897c9a03
        );
        assertEq(
            router.refundNonce(id, 0xe4F5853650f40f04e920c62F6dE9e4e38D767B66, keccak256("salt-1")),
            0x626e030da4e60de0d17bf6c6205d7f6cc4cee8e853470b61bc2f9f2efd12cc93
        );
    }

    function test_nonces_areDistinctPerKindIdAndSalt() public view {
        bytes32 id = router.invoiceIdOf(merchant, REF1);
        assertTrue(router.payNonce(id, S1) != router.payNonce(id, S2));
        assertTrue(router.payNonce(id, S1) != router.refundNonce(id, payer, S1));
        assertTrue(router.refundNonce(id, payer, S1) != router.refundNonce(id, payer2, S1));
    }

    // ================================================================ create

    function test_create_storesInvoiceAndEmits() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.payerLock = payer;
        r.minPayment = 10e6;
        bytes32 id = router.invoiceIdOf(merchant, REF1);
        bytes memory sig = _sig(merchantPk, _createHash(r));

        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouter.InvoiceCreated(id, merchant, payout, AMOUNT, r.dueDate, r.metaHash);
        vm.prank(relayer);
        router.createInvoice(r, sig);

        IPaymentRouter.Invoice memory inv = router.invoices(id);
        assertEq(inv.merchant, merchant);
        assertEq(inv.payout, payout);
        assertEq(inv.hook, address(0));
        assertEq(inv.payerLock, payer);
        assertEq(inv.amount, AMOUNT);
        assertEq(inv.minPayment, 10e6);
        assertEq(inv.paid, 0);
        assertEq(inv.refunded, 0);
        assertEq(inv.dueDate, r.dueDate);
        assertEq(uint8(inv.status), uint8(IPaymentRouter.Status.Open));
        assertEq(inv.metaHash, r.metaHash);
    }

    function test_create_twice_reverts_InvoiceExists() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        _create(r);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouter.InvoiceExists.selector);
        router.createInvoice(r, sig);
    }

    function test_create_sameRefDifferentMerchants_bothWork() public {
        _create(_req(REF1, AMOUNT));
        IPaymentRouter.CreateInvoice memory r2 = _req(REF1, AMOUNT);
        r2.merchant = payer;
        bytes memory sig = _sig(payerPk, _createHash(r2));
        router.createInvoice(r2, sig);
        assertEq(uint8(router.invoices(router.invoiceIdOf(payer, REF1)).status), uint8(IPaymentRouter.Status.Open));
    }

    function test_create_expiredDeadline_reverts() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.warp(r.deadline + 1);
        vm.expectRevert(IPaymentRouter.Expired.selector);
        router.createInvoice(r, sig);
    }

    function test_create_deadlineBoundary_isInclusive() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.warp(r.deadline);
        router.createInvoice(r, sig);
    }

    function test_create_wrongSigner_reverts() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(payerPk, _createHash(r));
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.createInvoice(r, sig);
    }

    function test_create_tamperedField_reverts() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        r.amount = AMOUNT + 1;
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.createInvoice(r, sig);
        r.amount = AMOUNT;
        r.payout = relayer;
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.createInvoice(r, sig);
    }

    function test_create_invalidInputs_revert() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, 0);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouter.ZeroAmount.selector);
        router.createInvoice(r, sig);

        r = _req(REF1, AMOUNT);
        r.payout = address(0);
        sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        router.createInvoice(r, sig);

        r = _req(REF1, AMOUNT);
        r.minPayment = AMOUNT + 1;
        sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouter.InvalidInvoice.selector);
        router.createInvoice(r, sig);
    }

    function test_create_minPaymentEqualToAmount_ok() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.minPayment = AMOUNT;
        _create(r);
    }

    function test_create_smartAccountMerchant_viaERC1271() public {
        MockWallet wallet = new MockWallet(merchant);
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.merchant = address(wallet);
        router.createInvoice(r, _sig(merchantPk, _createHash(r)));
        assertEq(router.invoices(router.invoiceIdOf(address(wallet), REF1)).merchant, address(wallet));
    }

    function test_create_smartAccountMerchant_wrongOwnerSigReverts() public {
        MockWallet wallet = new MockWallet(merchant);
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.merchant = address(wallet);
        bytes memory sig = _sig(payerPk, _createHash(r));
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.createInvoice(r, sig);
    }

    function test_create_whenPaused_reverts() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.prank(guardian);
        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.createInvoice(r, sig);
    }

    // ================================================================ delegated creation

    function test_creator_setThenCreate_works() public {
        bytes memory sig = _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0);
        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouter.CreatorSet(merchant, relayer, true);
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
        assertTrue(router.creators(merchant, relayer));
        assertEq(router.creatorNonce(merchant), 1);

        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.prank(relayer);
        router.createInvoiceAsCreator(r);
        assertEq(uint8(router.invoices(router.invoiceIdOf(merchant, REF1)).status), uint8(IPaymentRouter.Status.Open));
    }

    function test_creator_notDelegated_reverts() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouter.NotCreator.selector);
        router.createInvoiceAsCreator(r);
    }

    function test_creator_revoked_thenCreateReverts() public {
        router.setCreator(
            merchant, relayer, true, T0 + 1 days, _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0)
        );
        router.setCreator(
            merchant, relayer, false, T0 + 1 days, _creatorSig(merchantPk, merchant, relayer, false, T0 + 1 days, 1)
        );
        assertFalse(router.creators(merchant, relayer));
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouter.NotCreator.selector);
        router.createInvoiceAsCreator(r);
    }

    function test_creator_signatureCannotBeReplayed() public {
        bytes memory sig = _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0);
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
    }

    function test_creator_badSigAndExpiredAndZero_revert() public {
        bytes memory bad = _creatorSig(payerPk, merchant, relayer, true, T0 + 1 days, 0);
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.setCreator(merchant, relayer, true, T0 + 1 days, bad);

        bytes memory good = _creatorSig(merchantPk, merchant, relayer, true, T0 - 1, 0);
        vm.expectRevert(IPaymentRouter.Expired.selector);
        router.setCreator(merchant, relayer, true, T0 - 1, good);

        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        router.setCreator(merchant, address(0), true, T0 + 1 days, good);
    }

    function test_creator_expiredRequestReverts() public {
        router.setCreator(
            merchant, relayer, true, T0 + 1 days, _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0)
        );
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.warp(r.deadline + 1);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouter.Expired.selector);
        router.createInvoiceAsCreator(r);
    }

    function test_creator_delegationIsPerMerchant() public {
        router.setCreator(
            merchant, relayer, true, T0 + 1 days, _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0)
        );
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.merchant = payer; // relayer is not a creator for `payer`
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouter.NotCreator.selector);
        router.createInvoiceAsCreator(r);
    }

    // ================================================================ pay

    function test_pay_full_marksPaid_forwardsToPayout_emits() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);

        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouter.InvoicePaid(id, payer, AMOUNT, AMOUNT, true);
        vm.prank(relayer);
        router.pay(id, AMOUNT, a);

        IPaymentRouter.Invoice memory inv = router.invoices(id);
        assertEq(inv.paid, AMOUNT);
        assertEq(uint8(inv.status), uint8(IPaymentRouter.Status.Paid));
        assertEq(router.paidBy(id, payer), AMOUNT);
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(payer), 10_000e6 - AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(router.remaining(id), 0);
    }

    function test_pay_partialThenRest() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 30e6, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Open));
        assertEq(router.remaining(id), 70e6);
        _pay(id, 70e6, payer2Pk, S2);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
        assertEq(router.paidBy(id, payer), 30e6);
        assertEq(router.paidBy(id, payer2), 70e6);
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_pay_minimum_belowReverts_finalRemainderAllowed() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.minPayment = 30e6;
        bytes32 id = _create(r);
        IPaymentRouter.Auth memory small = _payAuth(payerPk, id, 29e6, S1);
        vm.expectRevert(IPaymentRouter.BelowMinimum.selector);
        router.pay(id, 29e6, small);

        _pay(id, 30e6, payerPk, S1);
        _pay(id, 30e6, payerPk, S2);
        _pay(id, 30e6, payerPk, keccak256("s3"));
        // remainder is 10e6, below the minimum, but it finishes the invoice
        _pay(id, 10e6, payerPk, keccak256("s4"));
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
    }

    function test_pay_overpay_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT + 1, S1);
        vm.expectRevert(IPaymentRouter.Overpay.selector);
        router.pay(id, AMOUNT + 1, a);
        _pay(id, 60e6, payerPk, S1);
        a = _payAuth(payerPk, id, 41e6, S2);
        vm.expectRevert(IPaymentRouter.Overpay.selector);
        router.pay(id, 41e6, a);
    }

    function test_pay_zero_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, 0, S1);
        vm.expectRevert(IPaymentRouter.ZeroAmount.selector);
        router.pay(id, 0, a);
    }

    function test_pay_unknownInvoice_reverts() public {
        IPaymentRouter.Auth memory a = _payAuth(payerPk, bytes32(uint256(1)), AMOUNT, S1);
        vm.expectRevert(IPaymentRouter.InvoiceNotFound.selector);
        router.pay(bytes32(uint256(1)), AMOUNT, a);
    }

    function test_pay_afterPaid_reverts_InvoiceNotOpen() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, 1e6, S2);
        vm.expectRevert(IPaymentRouter.InvoiceNotOpen.selector);
        router.pay(id, 1e6, a);
    }

    function test_pay_afterCancel_reverts_InvoiceNotOpen() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.cancel(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.expectRevert(IPaymentRouter.InvoiceNotOpen.selector);
        router.pay(id, AMOUNT, a);
    }

    function test_pay_payerLock_enforced() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.payerLock = payer;
        bytes32 id = _create(r);
        IPaymentRouter.Auth memory other = _payAuth(payer2Pk, id, AMOUNT, S1);
        vm.expectRevert(IPaymentRouter.WrongPayer.selector);
        router.pay(id, AMOUNT, other);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    function test_pay_relayerCannotRedirectAuthorizationToAnotherInvoice() public {
        bytes32 a = _newInvoice(REF1, AMOUNT);
        bytes32 b = _newInvoice(REF2, AMOUNT);
        IPaymentRouter.Auth memory authForA = _payAuth(payerPk, a, AMOUNT, S1);
        vm.prank(relayer);
        vm.expectRevert(bytes("invalid signature"));
        router.pay(b, AMOUNT, authForA);
        assertEq(usdt.balanceOf(payout), 0);
        assertEq(router.invoices(b).paid, 0);
    }

    function test_pay_wrongSalt_orAmount_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        a.salt = S2; // nonce no longer matches what was signed
        vm.expectRevert(bytes("invalid signature"));
        router.pay(id, AMOUNT, a);
        a = _payAuth(payerPk, id, 50e6, S1);
        vm.expectRevert(bytes("invalid signature"));
        router.pay(id, AMOUNT, a); // signed for 50, submitted for 100
    }

    function test_pay_replaySameAuthorization_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, 40e6, S1);
        router.pay(id, 40e6, a);
        vm.expectRevert(bytes("authorization is used"));
        router.pay(id, 40e6, a);
        assertEq(router.invoices(id).paid, 40e6);
    }

    function test_pay_authorizationWindow_enforced() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.warp(T0 + 1 days);
        vm.expectRevert(bytes("authorization is expired"));
        router.pay(id, AMOUNT, a);
    }

    function test_pay_payerWithoutFunds_revertsAndStateUnchanged() public {
        uint256 brokePk = 0xB0B0;
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(brokePk, id, AMOUNT, S1);
        vm.expectRevert();
        router.pay(id, AMOUNT, a);
        assertEq(router.invoices(id).paid, 0);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Open));
    }

    function test_pay_smartAccountPayer_viaERC1271() public {
        MockWallet wallet = new MockWallet(vm.addr(payerPk));
        usdt.mint(address(wallet), 500e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes32 nonce = router.payNonce(id, S1);
        IPaymentRouter.Auth memory a = IPaymentRouter.Auth({
            payer: address(wallet),
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: S1,
            signature: _sig(payerPk, _usdtDigest(address(wallet), AMOUNT, 0, T0 + 1 days, nonce))
        });
        router.pay(id, AMOUNT, a);
        assertEq(router.paidBy(id, address(wallet)), AMOUNT);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    function test_pay_whenPaused_reverts_thenWorksAfterUnpause() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.prank(guardian);
        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.pay(id, AMOUNT, a);
        vm.prank(owner);
        router.unpause();
        router.pay(id, AMOUNT, a);
    }

    // ================================================================ hook (sold invoice)

    function test_hook_paymentsGoToHook_andOnPaidCalled() public {
        MockHook hook = new MockHook();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        vm.expectEmit(true, true, false, false, address(router));
        emit IPaymentRouter.HookSet(id, address(hook));
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));

        _pay(id, 60e6, payerPk, S1);
        assertEq(usdt.balanceOf(address(hook)), 60e6);
        assertEq(usdt.balanceOf(payout), 0);
        assertEq(hook.totalReceived(), 60e6);
        assertEq(hook.lastId(), id);
        assertEq(hook.calls(), 1);
        _pay(id, 40e6, payerPk, S2);
        assertEq(usdt.balanceOf(address(hook)), AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_hook_revertingHook_revertsWholePayment() public {
        MockHook hook = new MockHook();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        hook.setShouldRevert(true);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.expectRevert(bytes("hook reverts"));
        router.pay(id, AMOUNT, a);
        assertEq(router.invoices(id).paid, 0);
        assertEq(usdt.balanceOf(payer), 10_000e6);
    }

    function test_hook_reentrantHook_isBlocked() public {
        ReentrantHook hook = new ReentrantHook(router);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        hook.arm(_payAuth(payer2Pk, id, 10e6, S2));
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, 50e6, S1);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        router.pay(id, 50e6, a);
        assertEq(router.invoices(id).paid, 0);
    }

    function test_hook_cannotChangeAfterPaymentOrTwice() public {
        MockHook hook = new MockHook();
        MockHook hook2 = new MockHook();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        bytes memory sig2 = _hookSig(merchantPk, id, address(hook2), T0 + 1 days);
        vm.expectRevert(IPaymentRouter.HookLocked.selector);
        router.setHook(id, address(hook2), T0 + 1 days, sig2);

        bytes32 id2 = _newInvoice(REF2, AMOUNT);
        _pay(id2, 10e6, payerPk, S1);
        bytes memory sig3 = _hookSig(merchantPk, id2, address(hook), T0 + 1 days);
        vm.expectRevert(IPaymentRouter.HookLocked.selector);
        router.setHook(id2, address(hook), T0 + 1 days, sig3);
    }

    function test_hook_validation() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory eoaSig = _hookSig(merchantPk, id, relayer, T0 + 1 days);
        vm.expectRevert(IPaymentRouter.NotAContract.selector);
        router.setHook(id, relayer, T0 + 1 days, eoaSig);

        MockHook hook = new MockHook();
        bytes memory wrongSigner = _hookSig(payerPk, id, address(hook), T0 + 1 days);
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.setHook(id, address(hook), T0 + 1 days, wrongSigner);

        bytes memory expired = _hookSig(merchantPk, id, address(hook), T0 - 1);
        vm.expectRevert(IPaymentRouter.Expired.selector);
        router.setHook(id, address(hook), T0 - 1, expired);

        bytes memory ok = _hookSig(merchantPk, bytes32(uint256(7)), address(hook), T0 + 1 days);
        vm.expectRevert(IPaymentRouter.InvoiceNotFound.selector);
        router.setHook(bytes32(uint256(7)), address(hook), T0 + 1 days, ok);
    }

    // ================================================================ cancel

    function test_cancel_setsCancelled_emits() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectEmit(true, false, false, false, address(router));
        emit IPaymentRouter.InvoiceCancelled(id);
        router.cancel(id, T0 + 1 days, sig);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Cancelled));
        assertEq(router.remaining(id), 0);
    }

    function test_cancel_validation() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory wrong = _cancelSig(payerPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        router.cancel(id, T0 + 1 days, wrong);
        bytes memory exp = _cancelSig(merchantPk, id, T0 - 1);
        vm.expectRevert(IPaymentRouter.Expired.selector);
        router.cancel(id, T0 - 1, exp);
        bytes memory unknown = _cancelSig(merchantPk, bytes32(uint256(9)), T0 + 1 days);
        vm.expectRevert(IPaymentRouter.InvoiceNotFound.selector);
        router.cancel(bytes32(uint256(9)), T0 + 1 days, unknown);
    }

    function test_cancel_paidInvoice_reverts_cancelTwice_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouter.InvoiceNotOpen.selector);
        router.cancel(id, T0 + 1 days, sig);

        bytes32 id2 = _newInvoice(REF2, AMOUNT);
        bytes memory sig2 = _cancelSig(merchantPk, id2, T0 + 1 days);
        router.cancel(id2, T0 + 1 days, sig2);
        vm.expectRevert(IPaymentRouter.InvoiceNotOpen.selector);
        router.cancel(id2, T0 + 1 days, sig2);
    }

    function test_cancel_afterPartialPayment_allowsRefundOfWhatWasPaid() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 40e6, payerPk, S1);
        router.cancel(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        _refund(id, 40e6, payer, S1);
        assertEq(router.invoices(id).refunded, 40e6);
    }

    // ================================================================ refund

    function test_refund_partial_movesMerchantFundsToPayer_emits() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 40e6, S1);
        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouter.InvoiceRefunded(id, payer, 40e6, 40e6);
        vm.prank(relayer);
        router.refund(id, 40e6, payer, a);

        assertEq(router.refundedTo(id, payer), 40e6);
        assertEq(router.invoices(id).refunded, 40e6);
        assertEq(usdt.balanceOf(merchant), 10_000e6 - 40e6);
        assertEq(usdt.balanceOf(payer), 10_000e6 - AMOUNT + 40e6);
        assertEq(usdt.balanceOf(payout), AMOUNT); // payout keeps what it got; merchant funds the refund
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_refund_inPartsUpToPaid_thenReverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        _refund(id, 60e6, payer, S1);
        _refund(id, 40e6, payer, S2);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 1, keccak256("s3"));
        vm.expectRevert(IPaymentRouter.RefundTooLarge.selector);
        router.refund(id, 1, payer, a);
    }

    function test_refund_onlyToPayersAndOnlyTheirShare() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 30e6, payerPk, S1);
        _pay(id, 70e6, payer2Pk, S2);
        // payer paid 30, cannot receive 31
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 31e6, S1);
        vm.expectRevert(IPaymentRouter.RefundTooLarge.selector);
        router.refund(id, 31e6, payer, a);
        // a stranger paid nothing
        a = _refundAuth(merchantPk, id, relayer, 1e6, S1);
        vm.expectRevert(IPaymentRouter.RefundTooLarge.selector);
        router.refund(id, 1e6, relayer, a);
        // each payer has their own cap
        _refund(id, 30e6, payer, S1);
        _refund(id, 70e6, payer2, S1);
    }

    function test_refund_validation() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 0, S1);
        vm.expectRevert(IPaymentRouter.ZeroAmount.selector);
        router.refund(id, 0, payer, a);
        a = _refundAuth(merchantPk, id, address(0), 1e6, S1);
        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        router.refund(id, 1e6, address(0), a);
        a = _refundAuth(merchantPk, bytes32(uint256(5)), payer, 1e6, S1);
        vm.expectRevert(IPaymentRouter.InvoiceNotFound.selector);
        router.refund(bytes32(uint256(5)), 1e6, payer, a);
    }

    function test_refund_mustBeFundedByTheMerchant() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(payer2Pk, id, payer, 10e6, S1); // a stranger funds it
        vm.expectRevert(IPaymentRouter.WrongPayer.selector);
        router.refund(id, 10e6, payer, a);
    }

    function test_refund_relayerCannotRedirectRecipientOrInvoice() public {
        bytes32 a1 = _newInvoice(REF1, AMOUNT);
        bytes32 a2 = _newInvoice(REF2, AMOUNT);
        _pay(a1, AMOUNT, payerPk, S1);
        _pay(a2, AMOUNT, payerPk, S2);
        // merchant signed a refund of 10 to `payer` on invoice 1
        IPaymentRouter.Auth memory auth = _refundAuth(merchantPk, a1, payer, 10e6, S1);
        // relayer tries the same signature for a different recipient...
        vm.expectRevert(IPaymentRouter.RefundTooLarge.selector); // attacker address has no paid share
        router.refund(a1, 10e6, relayer, auth);
        // ...or for the other invoice
        vm.expectRevert(bytes("invalid signature"));
        router.refund(a2, 10e6, payer, auth);
        assertEq(router.invoices(a1).refunded, 0);
        assertEq(router.invoices(a2).refunded, 0);
    }

    function test_refund_whenPaused_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 10e6, S1);
        vm.prank(guardian);
        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.refund(id, 10e6, payer, a);
    }

    // ================================================================ cancel vs sold invoices

    function test_cancel_whenHookSet_revertsInvoiceSold() public {
        MockHook hook = new MockHook();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouter.InvoiceSold.selector);
        router.cancel(id, T0 + 1 days, sig);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouter.InvoiceSold.selector);
        router.cancel(id, T0 + 1 days, sig);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Open));
    }

    function test_cancel_byTheHookItself_works() public {
        MockHook hook = new MockHook();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.prank(address(hook));
        router.cancel(id, T0 + 1 days, sig);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Cancelled));
    }

    // ================================================================ cumulative refund approval

    function test_refund_splitIntoSmallOnes_cannotDodgeApproval() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(100e6);
        bytes32 id = _newInvoice(REF1, 500e6);
        _pay(id, 500e6, payerPk, S1);
        for (uint256 i; i < 1; i++) {
            _refund(id, 100e6, payer, bytes32(i)); // first 100 is exactly at the threshold
        }
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 1, keccak256("more"));
        vm.expectRevert(IPaymentRouter.ApprovalRequired.selector);
        router.refund(id, 1, payer, a); // one more unit already needs a human
        // the same, as five 100s: the second one is refused
        bytes32 id2 = _newInvoice(REF2, 500e6);
        _pay(id2, 500e6, payerPk, S2);
        _refund(id2, 60e6, payer, bytes32(uint256(1)));
        a = _refundAuth(merchantPk, id2, payer, 41e6, bytes32(uint256(2)));
        vm.expectRevert(IPaymentRouter.ApprovalRequired.selector);
        router.refund(id2, 41e6, payer, a);
        _refund(id2, 40e6, payer, bytes32(uint256(3))); // exactly 100 cumulative is fine
    }

    function test_refundWithApproval_pastCumulativeThreshold_works() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(100e6);
        bytes32 id = _newInvoice(REF1, 500e6);
        _pay(id, 500e6, payerPk, S1);
        _refund(id, 100e6, payer, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 100e6, S2);
        IPaymentRouter.Approval memory ap = _approval(id, 100e6, payer, S2, T0 + 1 hours, attesterPk);
        router.refundWithApproval(id, 100e6, payer, a, ap);
        assertEq(router.invoices(id).refunded, 200e6);
        // the cumulative total stays above the threshold, so plain refunds stay blocked afterwards
        a = _refundAuth(merchantPk, id, payer, 1, keccak256("x"));
        vm.expectRevert(IPaymentRouter.ApprovalRequired.selector);
        router.refund(id, 1, payer, a);
    }

    function testFuzz_refund_cumulativeNeverPassesThresholdWithoutApproval(uint8 n, uint128 seed) public {
        uint128 threshold = 100e6;
        vm.prank(owner);
        router.setRefundApprovalThreshold(threshold);
        bytes32 id = _newInvoice(REF1, 10_000e6);
        _pay(id, 10_000e6, payerPk, S1);
        for (uint256 i; i < uint256(n) % 12; i++) {
            uint128 v = uint128(bound(uint256(keccak256(abi.encode(seed, i))), 1, 60e6));
            IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, v, bytes32(i));
            if (router.invoices(id).refunded + v > threshold) {
                vm.expectRevert(IPaymentRouter.ApprovalRequired.selector);
                router.refund(id, v, payer, a);
            } else {
                router.refund(id, v, payer, a);
            }
            assertLe(router.invoices(id).refunded, threshold);
        }
    }

    // ================================================================ reputation

    function _wireReputation() internal returns (ReputationRegistry rep) {
        rep = new ReputationRegistry(owner);
        vm.startPrank(owner);
        rep.setRecorder(address(router), true);
        router.setReputation(address(rep));
        vm.stopPrank();
    }

    function test_setReputation_onlyOwner_emits() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, payer));
        router.setReputation(address(1));
        vm.expectEmit(true, false, false, false, address(router));
        emit IPaymentRouter.ReputationSet(address(1));
        vm.prank(owner);
        router.setReputation(address(1));
        assertEq(router.reputation(), address(1));
    }

    function test_reputation_recordedOnFullPayment_onTime() public {
        ReputationRegistry rep = _wireReputation();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 40e6, payerPk, S1); // partial: nothing recorded yet
        assertEq(rep.paidCount(payer), 0);
        _pay(id, 60e6, payerPk, S2);
        ReputationRegistry.Record memory r = rep.recordOf(payer);
        assertEq(r.onTime, 1);
        assertEq(r.late, 0);
        assertEq(r.volume, AMOUNT);
    }

    function test_reputation_late_andNoDueDate() public {
        ReputationRegistry rep = _wireReputation();
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.dueDate = uint64(T0 + 1 hours);
        bytes32 late = _create(r);
        r = _req(REF2, AMOUNT);
        r.dueDate = 0;
        bytes32 open = _create(r);
        vm.warp(T0 + 2 hours);
        _pay(late, AMOUNT, payerPk, S1);
        assertEq(rep.recordOf(payer).late, 1);
        _pay(open, AMOUNT, payerPk, S2);
        assertEq(rep.recordOf(payer).onTime, 1);
    }

    function test_reputation_unset_paymentStillWorks() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(router.reputation(), address(0));
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
    }

    function test_reputation_routerNotARecorder_paymentStillWorks() public {
        ReputationRegistry rep = new ReputationRegistry(owner);
        vm.prank(owner);
        router.setReputation(address(rep));
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
        assertEq(rep.paidCount(payer), 0);
    }

    function test_reputation_revertingContract_neverBlocksPayment() public {
        address bad = address(new RevertingReputation());
        vm.prank(owner);
        router.setReputation(bad);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_reputation_gasBurner_neverBlocksPayment() public {
        address bad = address(new GasBurnerReputation());
        vm.prank(owner);
        router.setReputation(bad);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
    }

    function test_reputation_eoaOrEmptyAddress_neverBlocksPayment() public {
        vm.prank(owner);
        router.setReputation(makeAddr("noCode"));
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
    }

    // ================================================================ refund approval (human in the loop)

    function test_refund_aboveThreshold_needsApproval() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        _refund(id, 10e6, payer, S1); // exactly at the threshold: allowed
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 10e6 + 1, S2);
        vm.expectRevert(IPaymentRouter.ApprovalRequired.selector);
        router.refund(id, 10e6 + 1, payer, a);
    }

    function test_refundWithApproval_works_andIsSingleUse() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 50e6, S1);
        IPaymentRouter.Approval memory ap = _approval(id, 50e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.prank(relayer);
        router.refundWithApproval(id, 50e6, payer, a, ap);
        assertEq(router.invoices(id).refunded, 50e6);

        vm.expectRevert(IPaymentRouter.ApprovalUsed.selector);
        router.refundWithApproval(id, 50e6, payer, a, ap);
    }

    function test_refundWithApproval_rejectsWrongSignerAmountRecipientAndExpiry() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 50e6, S1);

        IPaymentRouter.Approval memory stranger = _approval(id, 50e6, payer, S1, T0 + 1 hours, payerPk);
        vm.expectRevert(IPaymentRouter.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, stranger);

        IPaymentRouter.Approval memory forOtherAmount = _approval(id, 20e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouter.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, forOtherAmount);

        IPaymentRouter.Approval memory forOtherRecipient = _approval(id, 50e6, payer2, S1, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouter.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, forOtherRecipient);

        IPaymentRouter.Approval memory forOtherSalt = _approval(id, 50e6, payer, S2, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouter.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, forOtherSalt);

        IPaymentRouter.Approval memory late = _approval(id, 50e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.warp(T0 + 2 hours);
        vm.expectRevert(IPaymentRouter.Expired.selector);
        router.refundWithApproval(id, 50e6, payer, a, late);
    }

    function test_refundWithApproval_stillCappedByWhatWasPaid() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 40e6, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 41e6, S1);
        IPaymentRouter.Approval memory ap = _approval(id, 41e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouter.RefundTooLarge.selector);
        router.refundWithApproval(id, 41e6, payer, a, ap);
    }

    function test_refundWithApproval_afterAttesterRotation_oldApprovalDies() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, 50e6, S1);
        IPaymentRouter.Approval memory ap = _approval(id, 50e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.prank(owner);
        router.setAttester(makeAddr("newAttester"));
        vm.expectRevert(IPaymentRouter.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, ap);
    }

    // ================================================================ views

    function test_isOverdue_andRemaining() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes32 paidId = _newInvoice(REF2, AMOUNT);
        _pay(paidId, AMOUNT, payerPk, S1); // paid while the authorization is still valid
        assertFalse(router.isOverdue(id));
        assertEq(router.remaining(id), AMOUNT);
        vm.warp(T0 + 30 days);
        assertFalse(router.isOverdue(id)); // exactly at the due date is not overdue
        vm.warp(T0 + 30 days + 1);
        assertTrue(router.isOverdue(id));
        assertFalse(router.isOverdue(paidId)); // paid invoices are never overdue
        assertEq(router.remaining(paidId), 0);
    }

    function test_isOverdue_noDueDate_neverOverdue() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.dueDate = 0;
        bytes32 id = _create(r);
        vm.warp(T0 + 3650 days);
        assertFalse(router.isOverdue(id));
    }

    // ================================================================ admin

    function test_pause_guardianOrOwner_only_unpauseOwnerOnly() public {
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouter.NotGuardianOrOwner.selector);
        router.pause();

        vm.prank(guardian);
        router.pause();
        assertTrue(router.paused());

        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        router.unpause();

        vm.prank(owner);
        router.unpause();
        assertFalse(router.paused());

        vm.prank(owner);
        router.pause();
        assertTrue(router.paused());
    }

    function test_adminSetters_onlyOwner_andValidated() public {
        vm.startPrank(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, relayer));
        router.setGuardian(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, relayer));
        router.setAttester(relayer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, relayer));
        router.setRefundApprovalThreshold(1);
        vm.stopPrank();

        vm.startPrank(owner);
        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        router.setGuardian(address(0));
        vm.expectRevert(IPaymentRouter.ZeroAddress.selector);
        router.setAttester(address(0));
        router.setGuardian(relayer);
        router.setAttester(relayer);
        router.setRefundApprovalThreshold(7);
        vm.stopPrank();
        assertEq(router.guardian(), relayer);
        assertEq(router.attester(), relayer);
        assertEq(router.refundApprovalThreshold(), 7);
    }

    function test_ownership_isTwoStep() public {
        address next = makeAddr("next");
        vm.prank(owner);
        router.transferOwnership(next);
        assertEq(router.owner(), owner);
        vm.prank(next);
        router.acceptOwnership();
        assertEq(router.owner(), next);
    }

    function test_routerNeverHoldsFunds_acrossAFullLifecycle() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 25e6, payerPk, S1);
        assertEq(usdt.balanceOf(address(router)), 0);
        _pay(id, 75e6, payer2Pk, S2);
        assertEq(usdt.balanceOf(address(router)), 0);
        _refund(id, 10e6, payer, S1);
        assertEq(usdt.balanceOf(address(router)), 0);
    }
}
