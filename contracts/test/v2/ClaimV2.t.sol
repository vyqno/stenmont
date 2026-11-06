// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.38;
import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";
import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
contract ClaimV2Test is ClaimBaseV2 {
    function testFundPaySettleAndReserveAccounting() public {
        bytes32 id = _funded("lifecycle");
        assertEq(usdt.balanceOf(address(claim)), RESERVE_AMT);
        _pay(id, AMOUNT, payerPk, "pay");
        assertEq(uint256(claim.claims(id).status), uint256(InvoiceClaimV2.ClaimStatus.Settled));
        assertEq(usdt.balanceOf(address(claim)),0);
        assertEq(usdt.balanceOf(address(router)),0);
        assertEq(claim.claims(id).toHolder, AMOUNT);
    }
    function testDiscountInvoiceCannotBeSold() public {
        bytes32 id = _create(_discountReq("discount", AMOUNT, 200, uint64(T0 + 10 days)));
        uint256 deadline = T0 + 1 days;
        bytes memory terms = _termsSig(merchantPk,id,500,1000,deadline);
        bytes memory hook = _hookSig(merchantPk,id,address(claim),deadline);
        vm.expectRevert(IPaymentRouterV2.DiscountActive.selector);
        claim.list(id,500,1000,deadline,terms,hook);
        assertEq(uint256(claim.claims(id).status),0);
    }
    function testDefaultReleasesReserveAndLatePaymentCapsHolder() public {
        bytes32 id = _funded("default");
        vm.warp(DUE + claim.GRACE() + 1);
        claim.markDefault(id);
        assertEq(usdt.balanceOf(address(claim)),0);
        _pay(id, AMOUNT, payerPk, "late");
        assertEq(claim.claims(id).toHolder, AMOUNT);
        assertEq(usdt.balanceOf(address(claim)),0);
    }
}
