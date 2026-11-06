// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {BaseV2} from "./BaseV2.t.sol";

contract RouterV2Test is BaseV2 {
    function testInvalidDiscountTerms() public {
        IPaymentRouterV2.CreateInvoice memory r = _discountReq("invalid", AMOUNT, 10_000, uint64(T0 + 10 days));
        bytes memory sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.InvalidDiscount.selector);
        router.createInvoice(r, sig);
        r.discountBps = 200; r.discountUntil = 0;
        sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.InvalidDiscount.selector);
        router.createInvoice(r, sig);
        r.discountUntil = uint64(T0 - 1);
        sig = _sig(merchantPk, _createHash(r));
        vm.expectRevert(IPaymentRouterV2.InvalidDiscount.selector);
        router.createInvoice(r, sig);
    }
    function testNonceVector() public view {
        assertEq(router.payNonce(
            0x9ef5cc50eed76dda0d467227d32f719840fdc30d278ccee49088083624704f1b,
            0xe4F5853650f40f04e920c62F6dE9e4e38D767B66,
            0xad7b6b88034155f1e86d31a54d7723ede2183a6538ecab39ce7a7144ff280fcd),
            0xbd89afbf3fe55dac91f778279a9d95336f1cb4be32c48a4923ab63ad829602f6);
    }

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
        assertEq(router.settlementAmount(id), 0);
        IPaymentRouterV2.Auth memory bad = _refundAuth(merchantPk, id, payer, AMOUNT, "refund");
        vm.expectRevert(IPaymentRouterV2.RefundTooLarge.selector);
        router.refund(id, AMOUNT, payer, bad);
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
        amount = uint128(bound(amount, 10_000, 1000e6));
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
