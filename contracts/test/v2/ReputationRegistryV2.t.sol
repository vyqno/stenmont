// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ReputationRegistryV2} from "../../src/ReputationRegistryV2.sol";
import {Test} from "forge-std/Test.sol";

contract ReputationRegistryV2Test is Test {
    ReputationRegistryV2 internal rep;
    address internal owner = makeAddr("owner");
    address internal router = makeAddr("router");
    address internal buyer = makeAddr("buyer");
    address internal supplierA = makeAddr("supplierA");
    address internal supplierB = makeAddr("supplierB");

    function setUp() public {
        rep = new ReputationRegistryV2(owner);
        vm.prank(owner);
        rep.setRecorder(router, true);
    }

    function test_noHistory_allZero() public view {
        assertEq(rep.score(buyer), 0);
        assertEq(rep.paidCount(buyer), 0);
        assertEq(rep.onTimeCounterparties(buyer), 0);
        assertFalse(rep.hasPaidOnTime(buyer, supplierA));
    }

    function test_record_keepsV1RecordShapeAndScore() public {
        vm.startPrank(router);
        vm.expectEmit(true, true, false, true, address(rep));
        emit ReputationRegistryV2.Recorded(buyer, supplierA, 100e6, true);
        rep.record(buyer, supplierA, 100e6, true);
        rep.record(buyer, supplierA, 50e6, true);
        rep.record(buyer, supplierB, 25e6, false);
        vm.stopPrank();
        ReputationRegistryV2.Record memory r = rep.recordOf(buyer);
        assertEq(r.onTime, 2);
        assertEq(r.late, 1);
        assertEq(r.volume, 175e6);
        assertEq(rep.paidCount(buyer), 3);
        assertEq(rep.score(buyer), 66);
    }

    /// The point of v2: many invoices from ONE supplier (or one colluding address) count once.
    function test_onTimeCounterparties_countsDistinctSuppliersOnly() public {
        vm.startPrank(router);
        vm.expectEmit(true, true, false, true, address(rep));
        emit ReputationRegistryV2.CounterpartyAdded(buyer, supplierA, 1);
        rep.record(buyer, supplierA, 1e6, true);
        for (uint256 i; i < 20; i++) {
            rep.record(buyer, supplierA, 1e6, true);
        }
        vm.stopPrank();
        assertEq(rep.paidCount(buyer), 21);
        assertEq(rep.onTimeCounterparties(buyer), 1, "20 more invoices from the same supplier add nothing");

        vm.prank(router);
        rep.record(buyer, supplierB, 1e6, true);
        assertEq(rep.onTimeCounterparties(buyer), 2);
        assertTrue(rep.hasPaidOnTime(buyer, supplierA));
        assertTrue(rep.hasPaidOnTime(buyer, supplierB));
    }

    function test_onTimeCounterparties_lateDoesNotCount_untilAnOnTimeOne() public {
        vm.startPrank(router);
        rep.record(buyer, supplierA, 1e6, false);
        assertEq(rep.onTimeCounterparties(buyer), 0);
        assertFalse(rep.hasPaidOnTime(buyer, supplierA));
        rep.record(buyer, supplierA, 1e6, true);
        vm.stopPrank();
        assertEq(rep.onTimeCounterparties(buyer), 1);
    }

    function test_onTimeCounterparties_isPerSubject() public {
        vm.startPrank(router);
        rep.record(buyer, supplierA, 1e6, true);
        rep.record(supplierB, supplierA, 1e6, true);
        vm.stopPrank();
        assertEq(rep.onTimeCounterparties(buyer), 1);
        assertEq(rep.onTimeCounterparties(supplierB), 1);
        assertFalse(rep.hasPaidOnTime(supplierA, buyer), "direction matters");
    }

    function test_record_selfDealing_reverts() public {
        vm.prank(router);
        vm.expectRevert(ReputationRegistryV2.SelfDealing.selector);
        rep.record(buyer, buyer, 1e6, true);
        assertEq(rep.paidCount(buyer), 0);
    }

    function test_record_zeroAddresses_revert() public {
        vm.startPrank(router);
        vm.expectRevert(ReputationRegistryV2.ZeroAddress.selector);
        rep.record(address(0), supplierA, 1, true);
        vm.expectRevert(ReputationRegistryV2.ZeroAddress.selector);
        rep.record(buyer, address(0), 1, true);
        vm.stopPrank();
    }

    function test_record_notRecorder_reverts() public {
        vm.expectRevert(ReputationRegistryV2.NotRecorder.selector);
        rep.record(buyer, supplierA, 1, true);
        vm.prank(owner);
        vm.expectRevert(ReputationRegistryV2.NotRecorder.selector);
        rep.record(buyer, supplierA, 1, true);
    }

    function test_setRecorder_access_zero_andRemoval() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        rep.setRecorder(router, false);
        vm.prank(owner);
        vm.expectRevert(ReputationRegistryV2.ZeroAddress.selector);
        rep.setRecorder(address(0), true);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(rep));
        emit ReputationRegistryV2.RecorderSet(router, false);
        rep.setRecorder(router, false);
        assertFalse(rep.isRecorder(router));
        vm.prank(router);
        vm.expectRevert(ReputationRegistryV2.NotRecorder.selector);
        rep.record(buyer, supplierA, 1, true);
    }

    /// counterparties <= on-time invoices, and equals the number of distinct suppliers that got an on-time payment
    function testFuzz_distinctCounterparties(uint8[24] calldata picks, bool[24] calldata onTime) public {
        address[4] memory suppliers = [supplierA, supplierB, makeAddr("c"), makeAddr("d")];
        bool[4] memory seen;
        uint256 distinct;
        vm.startPrank(router);
        for (uint256 i; i < 24; i++) {
            uint256 s = picks[i] % 4;
            rep.record(buyer, suppliers[s], 1, onTime[i]);
            if (onTime[i] && !seen[s]) {
                seen[s] = true;
                distinct++;
            }
        }
        vm.stopPrank();
        assertEq(rep.onTimeCounterparties(buyer), distinct);
        assertLe(rep.onTimeCounterparties(buyer), rep.recordOf(buyer).onTime);
        assertEq(rep.paidCount(buyer), 24);
        assertLe(rep.score(buyer), 100);
    }
}
