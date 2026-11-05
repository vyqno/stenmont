// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {DeployFactory} from "../script/DeployFactory.s.sol";
import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {Test} from "forge-std/Test.sol";

contract DeployFactoryTest is Test {
    function test_deploy_producesAWorkingFactoryWithALockedImplementation() public {
        vm.setEnv("STENMONT_DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(uint256(0xA11CE))));
        PasskeyAccountFactory factory = new DeployFactory().run();
        assertGt(address(factory).code.length, 0);
        PasskeyAccount implementation = PasskeyAccount(factory.implementation());
        assertGt(address(implementation).code.length, 0);
        vm.expectRevert(PasskeyAccount.AlreadyInitialized.selector);
        implementation.initialize(bytes32(0), bytes32(0));
    }
}
