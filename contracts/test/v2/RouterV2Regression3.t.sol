// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouterV2} from "../../src/PaymentRouterV2.sol";
import {ReputationRegistryV2} from "../../src/ReputationRegistryV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {BaseV2} from "./BaseV2.t.sol";
import {MockHookV2, ReentrantHookV2} from "./MockHookV2.sol";
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

contract RouterV2Regression3Test is RouterV2RegressionBase {
    function test_refund_mustBeFundedByTheMerchant() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(payer2Pk, id, payer, 10e6, S1); // a stranger funds it
        vm.expectRevert(IPaymentRouterV2.WrongPayer.selector);
        router.refund(id, 10e6, payer, a);
    }

    function test_refund_relayerCannotRedirectRecipientOrInvoice() public {
        bytes32 a1 = _newInvoice(REF1, AMOUNT);
        bytes32 a2 = _newInvoice(REF2, AMOUNT);
        _pay(a1, AMOUNT, payerPk, S1);
        _pay(a2, AMOUNT, payerPk, S2);
        // merchant signed a refund of 10 to `payer` on invoice 1
        IPaymentRouterV2.Auth memory auth = _refundAuth(merchantPk, a1, payer, 10e6, S1);
        // relayer tries the same signature for a different recipient...
        vm.expectRevert(IPaymentRouterV2.RefundTooLarge.selector); // attacker address has no paid share
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
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 10e6, S1);
        vm.prank(guardian);
        router.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.refund(id, 10e6, payer, a);
    }

    function test_cancel_whenHookSet_revertsInvoiceSold() public {
        MockHookV2 hook = new MockHookV2();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory hookSig_ = _hookSig(merchantPk, id, address(hook), T0 + 1 days);
        vm.prank(address(hook));
        router.setHook(id, address(hook), T0 + 1 days, hookSig_);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.InvoiceSold.selector);
        router.cancel(id, T0 + 1 days, sig);
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouterV2.InvoiceSold.selector);
        router.cancel(id, T0 + 1 days, sig);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Open));
    }

    function test_cancel_byTheHookItself_works() public {
        MockHookV2 hook = new MockHookV2();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        bytes memory hookSig_ = _hookSig(merchantPk, id, address(hook), T0 + 1 days);
        vm.prank(address(hook));
        router.setHook(id, address(hook), T0 + 1 days, hookSig_);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.prank(address(hook));
        router.cancel(id, T0 + 1 days, sig);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Cancelled));
    }

    function test_refund_splitIntoSmallOnes_cannotDodgeApproval() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(100e6);
        bytes32 id = _newInvoice(REF1, 500e6);
        _pay(id, 500e6, payerPk, S1);
        for (uint256 i; i < 1; i++) {
            _refund(id, 100e6, payer, bytes32(i)); // first 100 is exactly at the threshold
        }
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 1, keccak256("more"));
        vm.expectRevert(IPaymentRouterV2.ApprovalRequired.selector);
        router.refund(id, 1, payer, a); // one more unit already needs a human
        // the same, as five 100s: the second one is refused
        bytes32 id2 = _newInvoice(REF2, 500e6);
        _pay(id2, 500e6, payerPk, S2);
        _refund(id2, 60e6, payer, bytes32(uint256(1)));
        a = _refundAuth(merchantPk, id2, payer, 41e6, bytes32(uint256(2)));
        vm.expectRevert(IPaymentRouterV2.ApprovalRequired.selector);
        router.refund(id2, 41e6, payer, a);
        _refund(id2, 40e6, payer, bytes32(uint256(3))); // exactly 100 cumulative is fine
    }

    function test_refundWithApproval_pastCumulativeThreshold_works() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(100e6);
        bytes32 id = _newInvoice(REF1, 500e6);
        _pay(id, 500e6, payerPk, S1);
        _refund(id, 100e6, payer, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 100e6, S2);
        IPaymentRouterV2.Approval memory ap = _approval(id, 100e6, payer, S2, T0 + 1 hours, attesterPk);
        router.refundWithApproval(id, 100e6, payer, a, ap);
        assertEq(router.invoices(id).refunded, 200e6);
        // the cumulative total stays above the threshold, so plain refunds stay blocked afterwards
        a = _refundAuth(merchantPk, id, payer, 1, keccak256("x"));
        vm.expectRevert(IPaymentRouterV2.ApprovalRequired.selector);
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
            IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, v, bytes32(i));
            if (router.invoices(id).refunded + v > threshold) {
                vm.expectRevert(IPaymentRouterV2.ApprovalRequired.selector);
                router.refund(id, v, payer, a);
            } else {
                router.refund(id, v, payer, a);
            }
            assertLe(router.invoices(id).refunded, threshold);
        }
    }

    function test_setReputation_onlyOwner_emits() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, payer));
        router.setReputation(address(1));
        vm.expectEmit(true, false, false, false, address(router));
        emit IPaymentRouterV2.ReputationSet(address(1));
        vm.prank(owner);
        router.setReputation(address(1));
        assertEq(router.reputation(), address(1));
    }

    function test_reputation_recordedOnFullPayment_onTime() public {
        ReputationRegistryV2 rep = _wireReputation();
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 40e6, payerPk, S1); // partial: nothing recorded yet
        assertEq(rep.paidCount(payer), 0);
        _pay(id, 60e6, payerPk, S2);
        ReputationRegistryV2.Record memory r = rep.recordOf(payer);
        assertEq(r.onTime, 1);
        assertEq(r.late, 0);
        assertEq(r.volume, AMOUNT);
    }

    function test_reputation_late_andNoDueDate() public {
        ReputationRegistryV2 rep = _wireReputation();
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
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
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Paid));
    }

    function test_reputation_routerNotARecorder_paymentStillWorks() public {
        ReputationRegistryV2 rep = new ReputationRegistryV2(owner);
        vm.prank(owner);
        router.setReputation(address(rep));
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Paid));
        assertEq(rep.paidCount(payer), 0);
    }

    function test_reputation_revertingContract_neverBlocksPayment() public {
        address bad = address(new RevertingReputationV2());
        vm.prank(owner);
        router.setReputation(bad);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Paid));
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_reputation_gasBurner_neverBlocksPayment() public {
        address bad = address(new GasBurnerReputationV2());
        vm.prank(owner);
        router.setReputation(bad);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Paid));
    }

    function test_reputation_eoaOrEmptyAddress_neverBlocksPayment() public {
        vm.prank(owner);
        router.setReputation(makeAddr("noCode"));
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Paid));
    }

    function test_refund_aboveThreshold_needsApproval() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        _refund(id, 10e6, payer, S1); // exactly at the threshold: allowed
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 10e6 + 1, S2);
        vm.expectRevert(IPaymentRouterV2.ApprovalRequired.selector);
        router.refund(id, 10e6 + 1, payer, a);
    }

    function test_refundWithApproval_works_andIsSingleUse() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 50e6, S1);
        IPaymentRouterV2.Approval memory ap = _approval(id, 50e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.prank(relayer);
        router.refundWithApproval(id, 50e6, payer, a, ap);
        assertEq(router.invoices(id).refunded, 50e6);

        vm.expectRevert(IPaymentRouterV2.ApprovalUsed.selector);
        router.refundWithApproval(id, 50e6, payer, a, ap);
    }

    function test_refundWithApproval_rejectsWrongSignerAmountRecipientAndExpiry() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 50e6, S1);

        IPaymentRouterV2.Approval memory stranger = _approval(id, 50e6, payer, S1, T0 + 1 hours, payerPk);
        vm.expectRevert(IPaymentRouterV2.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, stranger);

        IPaymentRouterV2.Approval memory forOtherAmount = _approval(id, 20e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouterV2.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, forOtherAmount);

        IPaymentRouterV2.Approval memory forOtherRecipient = _approval(id, 50e6, payer2, S1, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouterV2.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, forOtherRecipient);

        IPaymentRouterV2.Approval memory forOtherSalt = _approval(id, 50e6, payer, S2, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouterV2.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, forOtherSalt);

        IPaymentRouterV2.Approval memory late = _approval(id, 50e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.warp(T0 + 2 hours);
        vm.expectRevert(IPaymentRouterV2.Expired.selector);
        router.refundWithApproval(id, 50e6, payer, a, late);
    }

    function test_refundWithApproval_stillCappedByWhatWasPaid() public {
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, 40e6, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 41e6, S1);
        IPaymentRouterV2.Approval memory ap = _approval(id, 41e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.expectRevert(IPaymentRouterV2.RefundTooLarge.selector);
        router.refundWithApproval(id, 41e6, payer, a, ap);
    }

    function test_refundWithApproval_afterAttesterRotation_oldApprovalDies() public {
        vm.prank(owner);
        router.setRefundApprovalThreshold(10e6);
        bytes32 id = _newInvoice(REF1, AMOUNT);
        _pay(id, AMOUNT, payerPk, S1);
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, payer, 50e6, S1);
        IPaymentRouterV2.Approval memory ap = _approval(id, 50e6, payer, S1, T0 + 1 hours, attesterPk);
        vm.prank(owner);
        router.setAttester(makeAddr("newAttester"));
        vm.expectRevert(IPaymentRouterV2.BadApproval.selector);
        router.refundWithApproval(id, 50e6, payer, a, ap);
    }

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
        IPaymentRouterV2.CreateInvoice memory r = _req(REF1, AMOUNT);
        r.dueDate = 0;
        bytes32 id = _create(r);
        vm.warp(T0 + 3650 days);
        assertFalse(router.isOverdue(id));
    }

    function test_pause_guardianOrOwner_only_unpauseOwnerOnly() public {
        vm.prank(relayer);
        vm.expectRevert(IPaymentRouterV2.NotGuardianOrOwner.selector);
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
        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
        router.setGuardian(address(0));
        vm.expectRevert(IPaymentRouterV2.ZeroAddress.selector);
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
