// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.38;

import {DeployV2} from "../../script/DeployV2.s.sol";
import {Test} from "forge-std/Test.sol";

contract DeployV2Test is Test, DeployV2 {
    function config() internal view returns (Config memory) {
        return Config(OFFICIAL_USDT, address(this), address(0xB0B), address(0xA11CE), 2_000_000);
    }

    function setUp() public {
        vm.chainId(1874);
        vm.etch(OFFICIAL_USDT, hex"00");
    }

    function test_rejectsOtherChainBeforeAnyDeployment() public {
        vm.chainId(1);
        vm.expectRevert("testnet chain only");
        this.validate(config(), address(this));
    }

    function test_rejectsWrongTokenOrMissingTokenCode() public {
        Config memory c = config();
        c.usdt = address(0xBAD);
        vm.expectRevert("official test USDT only");
        this.validate(c, address(this));
        vm.etch(OFFICIAL_USDT, hex"");
        vm.expectRevert("USDT code missing");
        this.validate(config(), address(this));
    }

    function test_rejectsWrongOwnerRoleAndThreshold() public {
        vm.expectRevert("deployer must own wiring");
        this.validate(config(), address(0xBAD));
        Config memory c = config();
        c.guardian = address(0);
        vm.expectRevert("zero role");
        this.validate(c, address(this));
        c = config();
        c.refundThreshold = 100e6;
        vm.expectRevert("API threshold mismatch");
        this.validate(c, address(this));
    }

    function test_deploysFreshSetAndWiresEveryRoleAndDomain() public {
        Config memory c = config();
        Deployment memory d = _deploy(c);
        _verify(c, d);
        assertEq(d.registry.owner(), address(this));
        assertEq(d.registry.attester(), c.attester);
        assertEq(d.router.owner(), address(this));
        assertEq(d.router.guardian(), c.guardian);
        assertEq(d.router.attester(), c.attester);
        assertEq(d.router.refundApprovalThreshold(), 2_000_000);
        assertEq(d.claim.owner(), address(this));
        assertEq(d.claim.guardian(), c.guardian);
        assertEq(d.subscriptions.guardian(), c.guardian);
        assertTrue(d.reputation.isRecorder(address(d.router)));
        assertFalse(d.reputation.isRecorder(address(0x1111)));
        assertFalse(d.registry.isAllowed(address(0x4444))); // no blanket investor grants
    }
}
