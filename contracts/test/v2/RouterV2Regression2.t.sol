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
contract RouterV2Regression2Test is RouterV2RegressionBase {
    function test_pay_overpay_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT + 1, S1);
        vm.expectRevert(IPaymentRouterV2.Overpay.selector);
        router.pay(id, AMOUNT + 1, payout, a);
        _pay(id, 60e6, payerPk, S1);
        a = _payAuth(payerPk, id, 41e6, S2);
        vm.expectRevert(IPaymentRouterV2.Overpay.selector);
        router.pay(id, 41e6, payout, a);
    }
    function test_pay_zero_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 0, S1);
        vm.expectRevert(IPaymentRouterV2.ZeroAmount.selector);
        router.pay(id, 0, payout, a);
    }
    function test_pay_unknownInvoice_reverts() public {
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, bytes32(uint256(1)), AMOUNT, S1);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotFound.selector);
        router.pay(bytes32(uint256(1)), AMOUNT, payout, a);
    }
    function test_pay_afterPaid_reverts_InvoiceNotOpen() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 1e6, S2);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotOpen.selector);
        router.pay(id, 1e6, payout, a);
    }
    function test_pay_afterCancel_reverts_InvoiceNotOpen() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.cancel(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotOpen.selector);
        router.pay(id, AMOUNT, payout, a);
    }
    function test_pay_payerLock_enforced() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.payerLock = payer;
        bytes32 id = _create(r);
        IPaymentRouterV2.Auth memory other = _payAuth(payer2Pk, id, AMOUNT, S1);
        vm.expectRevert(IPaymentRouterV2.WrongPayer.selector);
        router.pay(id, AMOUNT, payout, other);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }
    function test_pay_relayerCannotRedirectAuthorizationToAnotherInvoice() public {
        bytes32 a = _newInvoice(REF1, AMOUNT);
        bytes32 b = _newInvoice(REF2, AMOUNT);
        IPaymentRouterV2.Auth memory authForA = _payAuth(payerPk, a, AMOUNT, S1);
        vm.prank(relayer);
        vm.expectRevert(bytes("invalid signature"));
        router.pay(b, AMOUNT, payout, authForA);
        assertEq(usdt.balanceOf(payout), 0);
        assertEq(router.invoices(b).paid, 0);
    }
    function test_pay_wrongSalt_orAmount_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        a.salt = S2; // nonce no longer matches what was signed
        vm.expectRevert(bytes("invalid signature"));
        router.pay(id, AMOUNT, payout, a);
        a = _payAuth(payerPk, id, 50e6, S1);
        vm.expectRevert(bytes("invalid signature"));
        router.pay(id, AMOUNT, payout, a); // signed for 50, submitted for 100
    }
    function test_pay_replaySameAuthorization_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 40e6, S1);
        router.pay(id, 40e6, payout, a);
        vm.expectRevert(bytes("authorization is used"));
        router.pay(id, 40e6, payout, a);
        assertEq(router.invoices(id).paid, 40e6);
    }
    function test_pay_authorizationWindow_enforced() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.warp(a.validBefore);
        vm.expectRevert(bytes("authorization is expired"));
        router.pay(id, AMOUNT, payout, a);
    }
    function test_pay_payerWithoutFunds_revertsAndStateUnchanged() public {
        uint256 brokePk = 0xB0B0;
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(brokePk, id, AMOUNT, S1);
        vm.expectRevert();
        router.pay(id, AMOUNT, payout, a);
        assertEq(router.invoices(id).paid, 0);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Open));
    }
    function test_pay_smartAccountPayer_viaERC1271() public {
        MockWallet wallet = new MockWallet(vm.addr(payerPk));
        usdt.mint(address(wallet), 500e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes32 nonce = router.payNonce(id, payout, S1);
        IPaymentRouterV2.Auth memory a = IPaymentRouterV2.Auth({
            payer: address(wallet),
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: S1,
            signature: _sig(payerPk, _usdtDigest(address(wallet), AMOUNT, 0, T0 + 1 days, nonce))
        });
        router.pay(id, AMOUNT, payout, a);
        assertEq(router.paidBy(id, address(wallet)), AMOUNT);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }
    function test_pay_whenPaused_reverts_thenWorksAfterUnpause() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.prank(guardian);
        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.pay(id, AMOUNT, payout, a);
        vm.prank(owner);
        router.unpause();
        router.pay(id, AMOUNT, payout, a);
    }
    function test_hook_paymentsGoToHook_andOnPaidCalled() public {
        MockHookV2 hook = new MockHookV2();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        vm.expectEmit(true, true, false, false, address(router));
        emit IPaymentRouterV2.HookSet(id, address(hook));
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
        MockHookV2 hook = new MockHookV2();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        hook.setShouldRevert(true);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, S1);
        vm.expectRevert(bytes("hook reverts"));
        router.pay(id, AMOUNT, payout, a);
        assertEq(router.invoices(id).paid, 0);
        assertEq(usdt.balanceOf(payer), 10_000e6);
    }
    function test_hook_reentrantHook_isBlocked() public {
        ReentrantHookV2 hook = new ReentrantHookV2(router);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        hook.arm(_payAuth(payer2Pk, id, 10e6, S2));
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 50e6, S1);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        router.pay(id, 50e6, payout, a);
        assertEq(router.invoices(id).paid, 0);
    }
    function test_hook_cannotChangeAfterPaymentOrTwice() public {
        MockHookV2 hook = new MockHookV2();
        MockHookV2 hook2 = new MockHookV2();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        router.setHook(id, address(hook), T0 + 1 days, _hookSig(merchantPk, id, address(hook), T0 + 1 days));
        bytes memory sig2 = _hookSig(merchantPk, id, address(hook2), T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.HookLocked.selector);
        router.setHook(id, address(hook2), T0 + 1 days, sig2);

        bytes32 id2 = _newInvoice(REF2, AMOUNT);
        _pay(id2, 10e6, payerPk, S1);
        bytes memory sig3 = _hookSig(merchantPk, id2, address(hook), T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.HookLocked.selector);
        router.setHook(id2, address(hook), T0 + 1 days, sig3);
    }
    function test_hook_validation() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory eoaSig = _hookSig(merchantPk, id, relayer, T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.NotAContract.selector);
        router.setHook(id, relayer, T0 + 1 days, eoaSig);

        MockHookV2 hook = new MockHookV2();
        bytes memory wrongSigner = _hookSig(payerPk, id, address(hook), T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.setHook(id, address(hook), T0 + 1 days, wrongSigner);

        bytes memory expired = _hookSig(merchantPk, id, address(hook), T0 - 1);
        vm.expectRevert(IPaymentRouterV2.Expired.selector);
        router.setHook(id, address(hook), T0 - 1, expired);

        bytes memory ok = _hookSig(merchantPk, bytes32(uint256(7)), address(hook), T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotFound.selector);
        router.setHook(bytes32(uint256(7)), address(hook), T0 + 1 days, ok);
    }
    function test_cancel_setsCancelled_emits() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectEmit(true, false, false, false, address(router));
        emit IPaymentRouterV2.InvoiceCancelled(id);
        router.cancel(id, T0 + 1 days, sig);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Cancelled));
        assertEq(router.remaining(id), 0);
    }
    function test_cancel_validation() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory wrong = _cancelSig(payerPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.cancel(id, T0 + 1 days, wrong);
        bytes memory exp = _cancelSig(merchantPk, id, T0 - 1);
        vm.expectRevert(IPaymentRouterV2.Expired.selector);
        router.cancel(id, T0 - 1, exp);
        bytes memory unknown = _cancelSig(merchantPk, bytes32(uint256(9)), T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotFound.selector);
        router.cancel(bytes32(uint256(9)), T0 + 1 days, unknown);
    }
    function test_cancel_paidInvoice_reverts_cancelTwice_reverts() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotOpen.selector);
        router.cancel(id, T0 + 1 days, sig);

        bytes32 id2 = _newInvoice(REF2, AMOUNT);
        bytes memory sig2 = _cancelSig(merchantPk, id2, T0 + 1 days);
        router.cancel(id2, T0 + 1 days, sig2);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotOpen.selector);
        router.cancel(id2, T0 + 1 days, sig2);
    }
    function test_cancel_afterPartialPayment_allowsRefundOfWhatWasPaid() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 40e6, payerPk, S1);
        router.cancel(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        _refund(id, 40e6, payer, S1);
        assertEq(router.invoices(id).refunded, 40e6);
    }
    function test_refund_partial_movesMerchantFundsToPayer_emits() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 40e6, S1);
        vm.expectEmit(true, true, false, true, address(router));
        emit IPaymentRouterV2.InvoiceRefunded(id, payer, 40e6, 40e6);
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
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 1, keccak256("s3"));
        vm.expectRevert(IPaymentRouterV2.RefundTooLarge.selector);
        router.refund(id, 1, payer, a);
    }
    function test_refund_onlyToPayersAndOnlyTheirShare() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 30e6, payerPk, S1);
        _pay(id, 70e6, payer2Pk, S2);
        // payer paid 30, cannot receive 31
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 31e6, S1);
        vm.expectRevert(IPaymentRouterV2.RefundTooLarge.selector);
        router.refund(id, 31e6, payer, a);
        // a stranger paid nothing
        a = _refundAuth(merchantPk, id, relayer, 1e6, S1);
        vm.expectRevert(IPaymentRouterV2.RefundTooLarge.selector);
        router.refund(id, 1e6, relayer, a);
        // each payer has their own cap
        _refund(id, 30e6, payer, S1);
        _refund(id, 70e6, payer2, S1);
    }
    function test_refund_validation() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 0, S1);
        vm.expectRevert(IPaymentRouterV2.ZeroAmount.selector);
        router.refund(id, 0, payer, a);
        a = _refundAuth(merchantPk, id, address(0), 1e6, S1);
        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
        router.refund(id, 1e6, address(0), a);
        a = _refundAuth(merchantPk, bytes32(uint256(5)), payer, 1e6, S1);
        vm.expectRevert(IPaymentRouterV2.InvoiceNotFound.selector);
        router.refund(bytes32(uint256(5)), 1e6, payer, a);
    }
}
