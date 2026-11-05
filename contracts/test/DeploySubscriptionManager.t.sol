// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {DeploySubscriptionManager} from "../script/DeploySubscriptionManager.s.sol";
import {SubscriptionManager} from "../src/SubscriptionManager.sol";
import {Test} from "forge-std/Test.sol";

contract DeploySubscriptionManagerTest is Test {
    function test_deploy_wiresTheTokenAndRoles() public {
        address usdt = makeAddr("usdt");
        address owner = makeAddr("owner");
        vm.setEnv("USDT_ADDRESS", vm.toString(usdt));
        vm.setEnv("STENMONT_DEPLOYER_ADDRESS", vm.toString(owner));
        vm.setEnv("STENMONT_DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(uint256(0xA11CE))));
        SubscriptionManager mgr = new DeploySubscriptionManager().run();
        assertEq(address(mgr.usdt()), usdt);
        assertEq(mgr.owner(), owner);
        assertEq(mgr.guardian(), owner);
    }
}
