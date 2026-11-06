// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouterV2} from "../../src/PaymentRouterV2.sol";
import {ReputationRegistryV2} from "../../src/ReputationRegistryV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {BaseV2} from "./BaseV2.t.sol";
import {MockHookV2, ReentrantHookV2} from "./MockHookV2.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract RevertingReputationV2 {
    function record(address, address, uint128, bool) external pure {
        revert("nope");
    }
}

contract GasBurnerReputationV2 {
    function record(address, address, uint128, bool) external pure {
        while (true) {}
    }
}

import {RouterV2RegressionBase} from "./RouterV2RegressionBase.t.sol";
contract RouterV2Regression1Test is RouterV2RegressionBase {
    function test_constructor_setsConfig() public view {
        assertEq(address(router.usdt()), address(usdt));
        assertEq(router.owner(), owner);
        assertEq(router.guardian(), guardian);
        assertEq(router.attester(), attester);
        assertEq(router.refundApprovalThreshold(), THRESHOLD);
    }
    function test_constructor_zeroAddressesRevert() public {
        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
        new PaymentRouterV2(address(0), owner, guardian, attester, THRESHOLD);
        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
        new PaymentRouterV2(address(usdt), owner, address(0), attester, THRESHOLD);
        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
        new PaymentRouterV2(address(usdt), owner, guardian, address(0), THRESHOLD);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PaymentRouterV2(address(usdt), address(0), guardian, attester, THRESHOLD);
    }
    function test_ids_areMerchantScoped() public view {
        assertTrue(router.invoiceIdOf(merchant, REF1) != router.invoiceIdOf(payer, REF1));
        assertTrue(router.invoiceIdOf(merchant, REF1) != router.invoiceIdOf(merchant, REF2));
        assertEq(router.invoiceIdOf(merchant, REF1), keccak256(abi.encode(merchant, REF1)));
    }
    function test_nonces_areDistinctPerKindIdAndSalt() public view {
        bytes32 id = router.invoiceIdOf(merchant, REF1);
        assertTrue(router.payNonce(id, payout, S1) != router.payNonce(id, payout, S2));
        assertTrue(router.payNonce(id, payout, S1) != router.refundNonce(id, payer, S1));
        assertTrue(router.refundNonce(id, payer, S1) != router.refundNonce(id, payer2, S1));
    }
    function test_create_storesInvoiceAndEmits() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.payerLock = payer;
        r.minPayment = 10e6;
        bytes32 id = router.invoiceIdOf(merchant, REF1);
        bytes memory sig = _sig(merchantPk, _createHash(r));

        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouterV2.InvoiceCreated(id, merchant, payout, AMOUNT, r.dueDate, r.metaHash);
        vm.prank(relayer);
        router.createInvoice(r, sig);

        IPaymentRouterV2.Invoice memory inv = router.invoices(id);
        assertEq(inv.merchant, merchant);
        assertEq(inv.payout, payout);
        assertEq(inv.hook, address(0));
        assertEq(inv.payerLock, payer);
        assertEq(inv.amount, AMOUNT);
        assertEq(inv.minPayment, 10e6);
        assertEq(inv.paid, 0);
        assertEq(inv.refunded, 0);
        assertEq(inv.dueDate, r.dueDate);
        assertEq(uint8(inv.status), uint8(IPaymentRouterV2.Status.Open));
        assertEq(inv.metaHash, r.metaHash);
    }
    function test_create_twice_reverts_InvoiceExists() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        _create(r);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.InvoiceExists.selector);
        router.createInvoice(r, sig);
    }
    function test_create_sameRefDifferentMerchants_bothWork() public {
        _create(_req(REF1, AMOUNT));
        IPaymentRouterV2.CreateInvoice memory r2 = _req(REF1, AMOUNT);
        r2.merchant = payer;
        bytes memory sig = _sig(payerPk, _createHash(r2));
        router.createInvoice(r2, sig);
        assertEq(uint8(router.invoices(router.invoiceIdOf(payer, REF1)).status), uint8(IPaymentRouterV2.Status.Open));
    }
    function test_create_expiredDeadline_reverts() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.warp(r.deadline + 1);
        vm.expectRevert(IPaymentRouterV2.Expired.selector);
        router.createInvoice(r, sig);
    }
    function test_create_deadlineBoundary_isInclusive() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.warp(r.deadline);
        router.createInvoice(r, sig);
    }
    function test_create_wrongSigner_reverts() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(payerPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.createInvoice(r, sig);
    }
    function test_create_tamperedField_reverts() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        r.amount = AMOUNT + 1;
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.createInvoice(r, sig);
        r.amount = AMOUNT;
        r.payout = relayer;
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.createInvoice(r, sig);
    }
    function test_create_invalidInputs_revert() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, 0);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.ZeroAmount.selector);
        router.createInvoice(r, sig);

        r = _req(REF1, AMOUNT);
        r.payout = address(0);
        sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
        router.createInvoice(r, sig);

        r = _req(REF1, AMOUNT);
        r.minPayment = AMOUNT + 1;
        sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.InvalidInvoice.selector);
        router.createInvoice(r, sig);
    }
    function test_create_minPaymentEqualToAmount_ok() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.minPayment = AMOUNT;
        _create(r);
    }
    function test_create_smartAccountMerchant_viaERC1271() public {
        MockWallet wallet = new MockWallet(merchant);
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.merchant = address(wallet);
        router.createInvoice(r, _sig(merchantPk, _createHash(r)));
        assertEq(router.invoices(router.invoiceIdOf(address(wallet), REF1)).merchant, address(wallet));
    }
    function test_create_smartAccountMerchant_wrongOwnerSigReverts() public {
        MockWallet wallet = new MockWallet(merchant);
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.merchant = address(wallet);
        bytes memory sig = _sig(payerPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.createInvoice(r, sig);
    }
    function test_create_whenPaused_reverts() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.prank(guardian);
        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.createInvoice(r, sig);
    }
    function test_creator_setThenCreate_works() public {
        bytes memory sig = _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0);
        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouterV2.CreatorSet(merchant, relayer, true);
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
        assertTrue(router.creators(merchant, relayer));
        assertEq(router.creatorNonce(merchant), 1);

        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.prank(relayer);
        router.createInvoiceAsCreator(r);
        assertEq(uint8(router.invoices(router.invoiceIdOf(merchant, REF1)).status), uint8(IPaymentRouterV2.Status.Open));
    }
    function test_creator_notDelegated_reverts() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouterV2.NotCreator.selector);
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
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouterV2.NotCreator.selector);
        router.createInvoiceAsCreator(r);
    }
    function test_creator_signatureCannotBeReplayed() public {
        bytes memory sig = _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0);
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
    }
    function test_creator_badSigAndExpiredAndZero_revert() public {
        bytes memory bad = _creatorSig(payerPk, merchant, relayer, true, T0 + 1 days, 0);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.setCreator(merchant, relayer, true, T0 + 1 days, bad);

        bytes memory good = _creatorSig(merchantPk, merchant, relayer, true, T0 - 1, 0);
        vm.expectRevert(IPaymentRouterV2.Expired.selector);
        router.setCreator(merchant, relayer, true, T0 - 1, good);

        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
        router.setCreator(merchant, address(0), true, T0 + 1 days, good);
    }
    function test_creator_expiredRequestReverts() public {
        router.setCreator(
            merchant, relayer, true, T0 + 1 days, _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0)
        );
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        vm.warp(r.deadline + 1);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouterV2.Expired.selector);
        router.createInvoiceAsCreator(r);
    }
    function test_creator_delegationIsPerMerchant() public {
        router.setCreator(
            merchant, relayer, true, T0 + 1 days, _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, 0)
        );
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.merchant = payer; // relayer is not a creator for `payer`
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouterV2.NotCreator.selector);
        router.createInvoiceAsCreator(r);
    }
    function test_pay_full_marksPaid_forwardsToPayout_emits() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);

        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouterV2.InvoicePaid(id, payer, AMOUNT, AMOUNT, true);
        vm.prank(relayer);
        router.pay(id, AMOUNT, payout, a);

        IPaymentRouterV2.Invoice memory inv = router.invoices(id);
        assertEq(inv.paid, AMOUNT);
        assertEq(uint8(inv.status), uint8(IPaymentRouterV2.Status.Paid));
        assertEq(router.paidBy(id, payer), AMOUNT);
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(payer), 10_000e6 - AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(router.remaining(id), 0);
    }
    function test_pay_partialThenRest() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 30e6, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Open));
        assertEq(router.remaining(id), 70e6);
        _pay(id, 70e6, payer2Pk, S2);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Paid));
        assertEq(router.paidBy(id, payer), 30e6);
        assertEq(router.paidBy(id, payer2), 70e6);
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
    }
    function test_pay_minimum_belowReverts_finalRemainderAllowed() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.minPayment = 30e6;
        bytes32 id = _create(r);
        IPaymentRouterV2.Auth memory small = _payAuth(payerPk, id, 29e6, S1);
        vm.expectRevert(IPaymentRouterV2.BelowMinimum.selector);
        router.pay(id, 29e6, payout, small);

        _pay(id, 30e6, payerPk, S1);
        _pay(id, 30e6, payerPk, S2);
        _pay(id, 30e6, payerPk, keccak256("s3"));
        // remainder is 10e6, below the minimum, but it finishes the invoice
        _pay(id, 10e6, payerPk, keccak256("s4"));
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Paid));
    }
}
