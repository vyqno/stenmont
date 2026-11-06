// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {BaseV2} from "./BaseV2.t.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
contract RouterV2Test is BaseV2 {
    function testPayoutBindingRejectsTamperedRelayer() public {
        bytes32 id = _newInvoice("bound", AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuthFor(payerPk, id, AMOUNT, merchant, "salt");
        vm.expectRevert(IPaymentRouterV2.WrongPayout.selector);
        router.pay(id, AMOUNT, merchant, a);
        vm.expectRevert();
        router.pay(id, AMOUNT, payout, a);
        assertEq(usdt.balanceOf(payer), 10_000e6);
        assertEq(usdt.balanceOf(address(router)), 0);
    }
    function testDiscountSettlesAndRefundIsActualPaidOnly() public {
        bytes32 id = _create(_discountReq("discount", AMOUNT, 200, uint64(T0 + 10 days)));
        assertEq(router.settlementAmount(id), 98e6);
        _pay(id, 98e6, payerPk, "pay");
        assertEq(uint256(_status(id)), uint256(IPaymentRouterV2.Status.Paid));
        assertEq(router.invoices(id).discount, 2e6);
        assertEq(router.remaining(id), 0);
        vm.expectRevert(IPaymentRouterV2.RefundTooLarge.selector);
        _refund(id, AMOUNT, payer, "refund");
        _refund(id, 98e6, payer, "refund");
        assertEq(usdt.balanceOf(address(router)), 0);
    }
    function testDiscountExpiryAndPartialPaymentForfeitDiscount() public {
        bytes32 id = _create(_discountReq("partial", AMOUNT, 200, uint64(T0 + 10 days)));
        _pay(id, 1e6, payerPk, "one");
        assertEq(router.settlementAmount(id), 99e6);
        _pay(id, 99e6, payerPk, "rest");
        assertEq(router.invoices(id).discount, 0);
        id = _create(_discountReq("expired", AMOUNT, 200, uint64(T0 + 10 days)));
        vm.warp(T0 + 10 days + 1);
        assertEq(router.settlementAmount(id), AMOUNT);
    }
    function testHookRejectsAnyDiscountEvenAfterWindow() public {
        bytes32 id = _create(_discountReq("sold", AMOUNT, 200, uint64(T0 + 10 days)));
        vm.warp(T0 + 11 days);
        bytes memory sig = _hookSig(merchantPk, id, address(usdt), T0 + 20 days);
        vm.expectRevert(IPaymentRouterV2.DiscountActive.selector);
        router.setHook(id, address(usdt), T0 + 20 days, sig);
    }
    function testFuzzDiscountConservesValue(uint128 amount, uint16 bps) public {
        amount = uint128(bound(amount, 10_000, 1_000e6));
        bps = uint16(bound(bps, 1, 9999));
        bytes32 id = _create(_discountReq("fuzz", amount, bps, uint64(T0 + 10 days)));
        uint128 value = router.settlementAmount(id);
        _pay(id, value, payerPk, "pay");
        IPaymentRouterV2.Invoice memory inv = router.invoices(id);
        assertEq(uint256(inv.paid) + inv.discount, amount);
        assertEq(usdt.balanceOf(payout), value);
        assertEq(usdt.balanceOf(address(router)), 0);
    }
}
