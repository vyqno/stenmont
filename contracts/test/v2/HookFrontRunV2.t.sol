// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";

/// @notice Finding M-1: the merchant's SetHook signature travels inside a public `list` call. Anyone could copy it and
///         call `router.setHook` directly first, attaching the claim contract to an invoice it never listed: every
///         payment then reverts (NotListed) and nobody can cancel the invoice. Only the hook itself may attach.
contract HookFrontRunV2Test is ClaimBaseV2 {
    bytes32 internal constant REF = keccak256("HOOK-1");

    function test_copiedHookSig_cannotBeSubmittedDirectly_listStillWorks() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);

        vm.prank(makeAddr("frontRunner"));
        vm.expectRevert(IPaymentRouterV2.NotHook.selector);
        router.setHook(id, address(claim), deadline, hs);

        _list(id, DISCOUNT, RESERVE);
        assertEq(router.invoices(id).hook, address(claim));
        assertEq(uint8(claim.claims(id).status), uint8(InvoiceClaimV2.ClaimStatus.Listed));
        _pay(id, AMOUNT, payerPk, "p"); // payments still flow through the claim
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    function test_merchantCannotAttachAHookOnItsBehalf() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), T0 + 1 days);
        vm.prank(merchant);
        vm.expectRevert(IPaymentRouterV2.NotHook.selector);
        router.setHook(id, address(claim), T0 + 1 days, hs);
    }
}
