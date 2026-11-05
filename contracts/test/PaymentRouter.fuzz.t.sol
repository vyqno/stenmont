// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {Base} from "./Base.t.sol";

/// @dev Every number that feeds value math is fuzzed across its accepted domain.
///      Payers hold 10_000e6, so amounts are bounded to 5_000e6.
contract PaymentRouterFuzzTest is Base {
    uint128 internal constant MAX_AMOUNT = 5000e6;

    function testFuzz_idsAreInjective(address m1, address m2, bytes32 r1, bytes32 r2) public view {
        bool same = (m1 == m2) && (r1 == r2);
        assertEq(router.invoiceIdOf(m1, r1) == router.invoiceIdOf(m2, r2), same);
    }

    function testFuzz_noncesAreBoundToInvoiceAndSalt(bytes32 id1, bytes32 id2, bytes32 s1, bytes32 s2) public view {
        bool same = (id1 == id2) && (s1 == s2);
        assertEq(router.payNonce(id1, s1) == router.payNonce(id2, s2), same);
    }

    function testFuzz_refundNonceBoundToRecipient(bytes32 id, address a, address b, bytes32 salt) public view {
        assertEq(router.refundNonce(id, a, salt) == router.refundNonce(id, b, salt), a == b);
    }

    function testFuzz_createDeadline_isInclusive(uint256 deadline) public {
        deadline = bound(deadline, 0, T0 + 365 days);
        IPaymentRouter.CreateInvoice memory r = _req(keccak256("x"), AMOUNT);
        r.deadline = deadline;
        bytes memory sig = _sig(merchantPk, _createHash(r));
        if (block.timestamp > deadline) vm.expectRevert(IPaymentRouter.Expired.selector);
        router.createInvoice(r, sig);
    }

    function testFuzz_partialPaymentsAddUpExactly(uint128 amount, uint128 first) public {
        amount = uint128(bound(amount, 2, MAX_AMOUNT));
        first = uint128(bound(first, 1, amount - 1));
        bytes32 id = _newInvoice(keccak256("f1"), amount);
        _pay(id, first, payerPk, keccak256("a"));
        assertEq(router.remaining(id), amount - first);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Open));
        _pay(id, amount - first, payer2Pk, keccak256("b"));
        IPaymentRouter.Invoice memory inv = router.invoices(id);
        assertEq(inv.paid, amount);
        assertEq(uint8(inv.status), uint8(IPaymentRouter.Status.Paid));
        assertEq(usdt.balanceOf(payout), amount);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function testFuzz_overpayAlwaysReverts(uint128 amount, uint128 extra) public {
        amount = uint128(bound(amount, 1, MAX_AMOUNT));
        extra = uint128(bound(extra, 1, 1000e6));
        bytes32 id = _newInvoice(keccak256("f2"), amount);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, amount + extra, keccak256("a"));
        vm.expectRevert(IPaymentRouter.Overpay.selector);
        router.pay(id, amount + extra, a);
    }

    /// @dev Boundary classes: value < min (below), value == min (exact), value > min (above), value == remaining (finishes).
    function testFuzz_minimumPayment_boundary(uint128 amount, uint128 minPay, uint128 value) public {
        amount = uint128(bound(amount, 1, MAX_AMOUNT));
        minPay = uint128(bound(minPay, 1, amount));
        value = uint128(bound(value, 1, amount));
        IPaymentRouter.CreateInvoice memory r = _req(keccak256("f3"), amount);
        r.minPayment = minPay;
        bytes32 id = _create(r);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, value, keccak256("a"));
        bool allowed = value >= minPay || value == amount; // remaining == amount on a fresh invoice
        if (!allowed) vm.expectRevert(IPaymentRouter.BelowMinimum.selector);
        router.pay(id, value, a);
        assertEq(router.invoices(id).paid, allowed ? value : 0);
    }

    function testFuzz_refundNeverExceedsWhatThePayerPaid(uint128 paidAmt, uint128 refundAmt) public {
        paidAmt = uint128(bound(paidAmt, 1, MAX_AMOUNT));
        refundAmt = uint128(bound(refundAmt, 1, MAX_AMOUNT + 1000e6));
        bytes32 id = _newInvoice(keccak256("f4"), paidAmt);
        _pay(id, paidAmt, payerPk, keccak256("a"));
        vm.prank(owner);
        router.setRefundApprovalThreshold(type(uint128).max);
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, refundAmt, keccak256("r"));
        if (refundAmt > paidAmt) vm.expectRevert(IPaymentRouter.RefundTooLarge.selector);
        router.refund(id, refundAmt, payer, a);
        assertEq(router.invoices(id).refunded, refundAmt > paidAmt ? 0 : refundAmt);
    }

    /// @dev Boundary classes for the owner-set threshold: below, exactly at, first value above.
    function testFuzz_approvalThreshold_boundary(uint128 threshold, uint128 value) public {
        threshold = uint128(bound(threshold, 0, MAX_AMOUNT - 1));
        value = uint128(bound(value, 1, MAX_AMOUNT));
        vm.prank(owner);
        router.setRefundApprovalThreshold(threshold);
        bytes32 id = _newInvoice(keccak256("f5"), MAX_AMOUNT);
        _pay(id, MAX_AMOUNT, payerPk, keccak256("a"));
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, payer, value, keccak256("r"));
        if (value > threshold) {
            vm.expectRevert(IPaymentRouter.ApprovalRequired.selector);
            router.refund(id, value, payer, a);
            IPaymentRouter.Approval memory ap = _approval(id, value, payer, keccak256("r"), T0 + 1 hours, attesterPk);
            router.refundWithApproval(id, value, payer, a, ap);
        } else {
            router.refund(id, value, payer, a);
        }
        assertEq(router.invoices(id).refunded, value);
    }

    function testFuzz_overdueMatchesDueDate(uint64 dueDate, uint64 elapsed) public {
        dueDate = uint64(bound(dueDate, 0, T0 + 3650 days));
        elapsed = uint64(bound(elapsed, 0, 4000 days));
        IPaymentRouter.CreateInvoice memory r = _req(keccak256("f6"), AMOUNT);
        r.dueDate = dueDate;
        bytes32 id = _create(r);
        vm.warp(T0 + elapsed);
        assertEq(router.isOverdue(id), dueDate != 0 && block.timestamp > dueDate);
    }

    function testFuzz_payerLockOnlyAllowsTheLockedPayer(bool lockToPayer) public {
        IPaymentRouter.CreateInvoice memory r = _req(keccak256("f7"), AMOUNT);
        r.payerLock = lockToPayer ? payer : payer2;
        bytes32 id = _create(r);
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, AMOUNT, keccak256("a"));
        if (!lockToPayer) vm.expectRevert(IPaymentRouter.WrongPayer.selector);
        router.pay(id, AMOUNT, a);
    }
}
