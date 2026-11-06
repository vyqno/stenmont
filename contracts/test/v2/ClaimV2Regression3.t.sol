// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../../src/InvestorRegistry.sol";
import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {BaseV2} from "./BaseV2.t.sol";
import {MockHook} from "../mocks/MockHook.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";
contract ClaimV2Regression3Test is ClaimBaseV2 {
    bytes32 internal constant REF = keccak256("INV-1");
    function _claimStatus(bytes32 id) internal view returns(InvoiceClaimV2.ClaimStatus) { return claim.claims(id).status; }
    function test_markDefault_notFunded_reverts() public {
        bytes32 id = _listed(REF);
        vm.warp(T0 + 40 days);
        vm.expectRevert(InvoiceClaimV2.NotFunded.selector);
        claim.markDefault(id);
    }
    function test_markDefault_afterSettled_reverts() public {
        bytes32 id = _funded(REF);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        vm.warp(T0 + 40 days);
        vm.expectRevert(InvoiceClaimV2.NotFunded.selector);
        claim.markDefault(id);
    }
    function test_markDefault_paused_reverts() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        vm.prank(guardian);
        claim.pause();
        vm.expectRevert();
        claim.markDefault(id);
    }
    function test_markDefault_afterPartialPayment_reserveIsCappedAtWhatIsOwed() public {
        bytes32 id = _funded(REF);
        _pay(id, 95e6, payerPk, keccak256("p1")); // 5 left; reserve is 10
        uint256 i0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);
        vm.warp(T0 + 40 days);
        claim.markDefault(id);
        assertEq(usdt.balanceOf(investor), i0 + 5e6, "investor made whole, no more");
        assertEq(usdt.balanceOf(payout), pay0 + 5e6, "the rest of the reserve goes back to the merchant");
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(claim.claims(id).toHolder, AMOUNT);
    }
    function test_latePaymentAfterDefault_topsUpHolderUpToFace_restToMerchant() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        claim.markDefault(id); // holder has 10 of 100
        uint256 i0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);
        // invoice still open on the router: the payer settles late
        IPaymentRouterV2.Auth memory a = IPaymentRouterV2.Auth({
            payer: payer, validAfter: 0, validBefore: T0 + 60 days, salt: keccak256("late"), signature: ""
        });
        bytes32 nonce = router.payNonce(id, payout, a.salt);
        bytes32 sh = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer,
                address(router),
                uint256(AMOUNT),
                0,
                T0 + 60 days,
                nonce
            )
        );
        a.signature = _sig(payerPk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), sh)));
        router.pay(id, AMOUNT, payout, a);
        assertEq(usdt.balanceOf(investor), i0 + 90e6, "holder topped up to face (10 reserve + 90)");
        assertEq(usdt.balanceOf(payout), pay0 + 10e6, "the merchant keeps the surplus");
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Defaulted));
        assertEq(usdt.balanceOf(address(claim)), 0);
    }
    function test_paymentAfterDefaultAndFullCompensation_goesEntirelyToMerchant() public {
        bytes32 id = _funded(REF);
        _pay(id, 95e6, payerPk, keccak256("p1"));
        vm.warp(T0 + 40 days);
        claim.markDefault(id); // holder is now at exactly face
        assertEq(claim.claims(id).toHolder, AMOUNT);
        uint256 i0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);
        usdt.mint(address(claim), 5e6); // emulate the router transferring the late 5
        vm.prank(address(router));
        claim.onPaid(id, 5e6);
        assertEq(usdt.balanceOf(investor), i0);
        assertEq(usdt.balanceOf(payout), pay0 + 5e6);
    }
    function test_transfer_toAllowlisted_ok() public {
        bytes32 id = _funded(REF);
        vm.prank(investor);
        claim.transferFrom(investor, investor2, uint256(id));
        assertEq(claim.ownerOf(uint256(id)), investor2);
    }
    function test_transfer_safeTransferToAllowlistedContract_ok() public {
        bytes32 id = _funded(REF);
        ReceiverV2 r = new ReceiverV2();
        _allowAddr(address(r));
        vm.prank(investor);
        claim.safeTransferFrom(investor, address(r), uint256(id));
        assertEq(claim.ownerOf(uint256(id)), address(r));
    }
    function test_transfer_approvedOperator_ok() public {
        bytes32 id = _funded(REF);
        address op = makeAddr("operator");
        vm.prank(investor);
        claim.approve(op, uint256(id));
        vm.prank(op);
        claim.transferFrom(investor, investor2, uint256(id));
        assertEq(claim.ownerOf(uint256(id)), investor2);
    }
    function test_transfer_toNonAllowlisted_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaimV2.NotAllowlisted.selector);
        claim.transferFrom(investor, makeAddr("stranger"), uint256(id));
    }
    function test_transfer_toBlockedAccount_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        registry.setBlocked(investor2, true);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaimV2.NotAllowlisted.selector);
        claim.transferFrom(investor, investor2, uint256(id));
    }
    function test_transfer_fromRevokedHolder_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        registry.revoke(investor);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaimV2.NotAllowlisted.selector);
        claim.transferFrom(investor, investor2, uint256(id));
        // but they still get paid
        uint256 i0 = usdt.balanceOf(investor);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        assertEq(usdt.balanceOf(investor), i0 + AMOUNT);
    }
    function test_transfer_toAccountWhoseEntryExpired_reverts() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 366 days);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaimV2.NotAllowlisted.selector);
        claim.transferFrom(investor, investor2, uint256(id));
    }
    function test_transfer_afterSettled_reverts() public {
        bytes32 id = _funded(REF);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        vm.prank(investor);
        vm.expectRevert(InvoiceClaimV2.TransferLocked.selector);
        claim.transferFrom(investor, investor2, uint256(id));
    }
    function test_transfer_afterDefault_ok() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        claim.markDefault(id);
        vm.prank(investor);
        claim.transferFrom(investor, investor2, uint256(id));
        assertEq(claim.ownerOf(uint256(id)), investor2);
    }
    function test_transfer_paused_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        claim.pause();
        vm.prank(investor);
        vm.expectRevert();
        claim.transferFrom(investor, investor2, uint256(id));
    }
    function test_transfer_byNonOwnerNonApproved_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(investor2);
        vm.expectRevert();
        claim.transferFrom(investor, investor2, uint256(id));
    }
    function test_payments_stillWorkWhilePaused() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        claim.pause();
        uint256 i0 = usdt.balanceOf(investor);
        _pay(id, AMOUNT, payerPk, keccak256("p1")); // a pause never traps the customer's payment
        assertEq(usdt.balanceOf(investor), i0 + AMOUNT);
    }
    function _allowAddr(address who) internal {
        uint64 exp = uint64(T0 + 100 days);
        bytes32 d = keccak256(
            abi.encodePacked(
                "\x19\x01",
                registry.domainSeparator(),
                keccak256(abi.encode(registry.ALLOW_TYPEHASH(), who, exp, T0 + 1 days, registry.nonces(who)))
            )
        );
        registry.allow(who, exp, T0 + 1 days, _sig(attesterPk, d));
    }
    function test_withdrawPending_nothing_reverts() public {
        vm.expectRevert(InvoiceClaimV2.NothingPending.selector);
        claim.withdrawPending(investor);
    }
    function test_withdrawPending_zeroTo_reverts() public {
        vm.expectRevert(InvoiceClaimV2.ZeroAddress.selector);
        claim.withdrawPending(address(0));
    }
    function test_pause_guardianOwner_ok_othersRevert() public {
        vm.prank(guardian);
        claim.pause();
        assertTrue(claim.paused());
        vm.prank(owner);
        claim.unpause();
        vm.prank(owner);
        claim.pause();
        assertTrue(claim.paused());
        vm.prank(owner);
        claim.unpause();

        vm.prank(makeAddr("rando"));
        vm.expectRevert(InvoiceClaimV2.NotGuardianOrOwner.selector);
        claim.pause();
        vm.prank(address(0));
        vm.expectRevert(InvoiceClaimV2.NotGuardianOrOwner.selector);
        claim.pause();
        vm.prank(address(claim));
        vm.expectRevert(InvoiceClaimV2.NotGuardianOrOwner.selector);
        claim.pause();
    }
    function test_unpause_guardianCannot() public {
        vm.prank(guardian);
        claim.pause();
        vm.prank(guardian);
        vm.expectRevert();
        claim.unpause();
    }
    function test_setGuardian() public {
        address g = makeAddr("g2");
        vm.prank(owner);
        claim.setGuardian(g);
        assertEq(claim.guardian(), g);
        vm.prank(owner);
        vm.expectRevert(InvoiceClaimV2.ZeroAddress.selector);
        claim.setGuardian(address(0));
        vm.prank(guardian);
        vm.expectRevert();
        claim.setGuardian(g);
        vm.prank(address(0));
        vm.expectRevert();
        claim.setGuardian(g);
    }
    function test_ownership_isTwoStep() public {
        address next = makeAddr("next");
        vm.prank(owner);
        claim.transferOwnership(next);
        assertEq(claim.owner(), owner);
        vm.prank(next);
        claim.acceptOwnership();
        assertEq(claim.owner(), next);
    }
}
contract ReceiverV2 is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
