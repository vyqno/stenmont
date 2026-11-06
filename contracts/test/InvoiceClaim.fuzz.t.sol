// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvoiceClaim} from "../src/InvoiceClaim.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {ClaimBase} from "./InvoiceClaim.t.sol";

/// @dev Money math across the whole domain: nobody gets more than owed, the seller keeps the agreed advance, and the
///      USDT that goes in always equals the USDT that comes out.
contract InvoiceClaimFuzzTest is ClaimBase {
    function _bounds(uint128 face, uint16 d, uint16 r) internal pure returns (uint128, uint16, uint16) {
        face = uint128(bound(face, 2, 1e15));
        d = uint16(bound(d, 0, 9999));
        r = uint16(bound(r, 0, 10_000 - d));
        return (face, d, r);
    }

    function _payLong(bytes32 id, uint128 value, bytes32 salt) internal {
        uint256 validBefore = block.timestamp + 1 days;
        bytes32 nonce = router.payNonce(id, salt);
        bytes32 sh = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer,
                address(router),
                uint256(value),
                0,
                validBefore,
                nonce
            )
        );
        IPaymentRouter.Auth memory a = IPaymentRouter.Auth({
            payer: payer,
            validAfter: 0,
            validBefore: validBefore,
            salt: salt,
            signature: _sig(payerPk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), sh)))
        });
        router.pay(id, value, a);
    }

    /// @dev Lists and funds an invoice of `face`; returns what the investor paid and the reserve.
    function _sell(uint128 face, uint16 d, uint16 r) internal returns (bytes32 id, uint128 price, uint128 reserve) {
        (price, reserve) = claim.quote(face, d, r);
        usdt.mint(investor, price);
        usdt.mint(payer, face);
        id = _newInvoice(keccak256(abi.encode(face, d, r)), face);
        _list(id, d, r);
        _fund(id, investorPk, price);
    }

    /// quote: price <= face, reserve <= price, and each rounds down by less than one unit.
    function testFuzz_quote_boundsAndRounding(uint128 face, uint16 d, uint16 r) public view {
        d = uint16(bound(d, 0, 9999));
        r = uint16(bound(r, 0, 10_000 - d));
        (uint128 price, uint128 reserve) = claim.quote(face, d, r);
        assertLe(price, face);
        assertLe(reserve, price);
        uint256 exactPrice = uint256(face) * (10_000 - d); // scaled by 10_000
        assertLe(uint256(price) * 10_000, exactPrice);
        assertGt(uint256(price) * 10_000 + 10_000, exactPrice); // rounded down by < 1 unit
        assertLe(uint256(reserve) * 10_000, uint256(face) * r);
    }

    /// quote: the first invalid values revert (discount 10000, or discount + reserve above 10000).
    function testFuzz_quote_invalidReverts(uint128 face, uint16 d, uint16 r) public {
        d = uint16(bound(d, 0, 10_000));
        r = uint16(bound(r, 10_001 - d, type(uint16).max));
        vm.expectRevert(InvoiceClaim.BadTerms.selector);
        claim.quote(face, d, r);
    }

    /// Paid in full, in up to three parts: holder receives exactly `face`, merchant exactly `price` in total.
    function testFuzz_fullPayment_splitsExactly(uint128 face, uint16 d, uint16 r, uint128 cut1, uint128 cut2) public {
        (face, d, r) = _bounds(face, d, r);
        (uint128 price, uint128 reserve) = claim.quote(face, d, r);
        vm.assume(price != 0);
        usdt.mint(investor, price);
        usdt.mint(payer, face);
        uint256 inv0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);
        uint256 payer0 = usdt.balanceOf(payer);

        bytes32 id = _newInvoice(keccak256("f"), face);
        _list(id, d, r);
        _fund(id, investorPk, price);
        assertEq(usdt.balanceOf(payout) - pay0, price - reserve, "seller gets the agreed advance at funding");

        uint128 a1 = uint128(bound(cut1, 1, face));
        uint128 a2 = uint128(bound(cut2, 0, face - a1));
        _payLong(id, a1, keccak256("1"));
        if (a2 != 0) _payLong(id, a2, keccak256("2"));
        if (a1 + a2 != face) _payLong(id, face - a1 - a2, keccak256("3"));

        assertEq(usdt.balanceOf(investor), inv0 - price + face, "investor receives exactly face");
        assertEq(usdt.balanceOf(payout) - pay0, price, "seller ends with exactly the price");
        assertEq(usdt.balanceOf(payer), payer0 - face);
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Settled));
    }

    /// Default after any part payment: the investor gets at most `face`, the seller never less than the advance, and
    /// what goes in equals what comes out. A late payment afterwards keeps the same bounds.
    function testFuzz_default_neverPaysHolderMoreThanFace(
        uint128 face,
        uint16 d,
        uint16 r,
        uint128 paidFirst,
        uint128 latePayment
    ) public {
        (face, d, r) = _bounds(face, d, r);
        (uint128 price, uint128 reserve) = claim.quote(face, d, r);
        vm.assume(price != 0);
        usdt.mint(investor, price);
        usdt.mint(payer, face);
        uint256 inv0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);

        bytes32 id = _newInvoice(keccak256("f"), face);
        _list(id, d, r);
        _fund(id, investorPk, price);

        uint128 first = uint128(bound(paidFirst, 0, face - 1)); // leaves something unpaid
        if (first != 0) _payLong(id, first, keccak256("1"));
        vm.warp(T0 + 30 days + 7 days + 1);
        claim.markDefault(id);

        uint256 investorGot = usdt.balanceOf(investor) + price - inv0;
        uint256 sellerGot = usdt.balanceOf(payout) - pay0;
        assertLe(investorGot, face, "never more than owed");
        assertGe(sellerGot, price - reserve, "never less than the advance");
        assertEq(investorGot + sellerGot, uint256(price) + first, "in == out");
        assertEq(usdt.balanceOf(address(claim)), 0);

        // late payer settles part or all of what is left
        uint128 left = face - first;
        uint128 late = uint128(bound(latePayment, 1, left));
        _payLong(id, late, keccak256("late"));
        investorGot = usdt.balanceOf(investor) + price - inv0;
        sellerGot = usdt.balanceOf(payout) - pay0;
        assertLe(investorGot, face, "late payment cannot push the holder above face");
        assertGe(sellerGot, price - reserve);
        assertEq(investorGot + sellerGot, uint256(price) + first + late, "in == out after the late payment");
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    /// Boundary: grace ends exactly at dueDate + 7 days. At the boundary default reverts, one second later it works.
    function testFuzz_graceBoundary(uint64 extra) public {
        (bytes32 id,,) = _sell(100e6, 500, 1000);
        uint256 boundary = T0 + 30 days + 7 days;
        vm.warp(boundary - bound(extra, 0, 7 days)); // at or before the boundary
        vm.expectRevert(InvoiceClaim.GraceNotOver.selector);
        claim.markDefault(id);
        vm.warp(boundary + 1);
        claim.markDefault(id);
    }
}
