// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Finding M-3: a deferred payout could only be pulled by its owner calling `withdrawPending`. Passkey
///         accounts (the product's merchant and investor wallets) cannot send transactions, so their pending USDT was
///         stuck for good. Anyone may now push a pending payout to its owner, and only to its owner.
contract PendingPushV2Test is ClaimBaseV2 {
    bytes32 internal constant REF = keccak256("PUSH-1");

    function test_signatureOnlyHolder_pendingCanBePushedToIt() public {
        bytes32 id = _funded(REF);
        MockWallet wallet = new MockWallet(investor); // stands in for a passkey account: it can only sign
        _allow(address(wallet));
        vm.prank(investor);
        claim.transferFrom(investor, address(wallet), uint256(id));

        vm.mockCallRevert(address(usdt), abi.encodeCall(IERC20.transfer, (address(wallet), uint256(AMOUNT))), "x");
        _pay(id, AMOUNT, payerPk, "s");
        vm.clearMockedCalls();
        assertEq(claim.pending(address(wallet)), AMOUNT);

        vm.expectEmit(true, true, false, true, address(claim));
        emit InvoiceClaimV2.PendingWithdrawn(address(wallet), address(wallet), AMOUNT);
        vm.prank(makeAddr("anyone"));
        claim.withdrawPendingFor(address(wallet));
        assertEq(usdt.balanceOf(address(wallet)), AMOUNT);
        assertEq(claim.pending(address(wallet)), 0);
        assertEq(claim.totalPending(), 0);
        assertEq(usdt.balanceOf(address(claim)), 0);
    }

    function test_push_stillRefused_keepsItPending() public {
        bytes32 id = _funded(REF);
        vm.mockCallRevert(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(AMOUNT))), "x");
        _pay(id, AMOUNT, payerPk, "s");
        vm.expectRevert();
        claim.withdrawPendingFor(investor);
        vm.clearMockedCalls();
        assertEq(claim.pending(investor), AMOUNT);
        claim.withdrawPendingFor(investor);
        assertEq(claim.pending(investor), 0);
    }

    function test_push_nothingPending_reverts() public {
        vm.expectRevert(InvoiceClaimV2.NothingPending.selector);
        claim.withdrawPendingFor(investor);
    }
}
