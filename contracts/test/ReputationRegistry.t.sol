// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {Test} from "forge-std/Test.sol";

contract ReputationRegistryTest is Test {
    ReputationRegistry internal rep;
    address internal owner = makeAddr("owner");
    address internal router = makeAddr("router");
    address internal payer = makeAddr("payer");

    function setUp() public {
        rep = new ReputationRegistry(owner);
        vm.prank(owner);
        rep.setRecorder(router, true);
    }

    function test_noHistory_scoreZero() public view {
        assertEq(rep.score(payer), 0);
        assertEq(rep.paidCount(payer), 0);
    }

    function test_record_onTimeAndLate() public {
        vm.startPrank(router);
        vm.expectEmit(true, false, false, true, address(rep));
        emit ReputationRegistry.Recorded(payer, 100e6, true);
        rep.record(payer, 100e6, true);
        rep.record(payer, 50e6, true);
        rep.record(payer, 25e6, false);
        vm.stopPrank();
        ReputationRegistry.Record memory r = rep.recordOf(payer);
        assertEq(r.onTime, 2);
        assertEq(r.late, 1);
        assertEq(r.volume, 175e6);
        assertEq(rep.paidCount(payer), 3);
        assertEq(rep.score(payer), 66);
    }

    function test_record_notRecorder_reverts() public {
        vm.expectRevert(ReputationRegistry.NotRecorder.selector);
        rep.record(payer, 1, true);
        vm.prank(owner);
        vm.expectRevert(ReputationRegistry.NotRecorder.selector);
        rep.record(payer, 1, true);
    }

    function test_setRecorder_access_andZero() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        rep.setRecorder(router, false);
        vm.prank(owner);
        vm.expectRevert(ReputationRegistry.ZeroAddress.selector);
        rep.setRecorder(address(0), true);
        vm.prank(owner);
        rep.setRecorder(router, false);
        vm.prank(router);
        vm.expectRevert(ReputationRegistry.NotRecorder.selector);
        rep.record(payer, 1, true);
    }

    function testFuzz_scoreBounded(uint8 onTime, uint8 late) public {
        vm.startPrank(router);
        for (uint256 i; i < onTime; i++) {
            rep.record(payer, 1, true);
        }
        for (uint256 i; i < late; i++) {
            rep.record(payer, 1, false);
        }
        vm.stopPrank();
        uint256 s = rep.score(payer);
        assertLe(s, 100);
        if (uint256(onTime) + late > 0) assertEq(s, (100 * uint256(onTime)) / (uint256(onTime) + late));
    }
}
