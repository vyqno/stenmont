// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {DeployFinancing} from "../script/DeployFinancing.s.sol";
import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {InvoiceClaim} from "../src/InvoiceClaim.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {Test} from "forge-std/Test.sol";

contract DeployFinancingTest is Test {
    function test_deploy_wiresEverything() public {
        address usdt = makeAddr("usdt");
        address router = makeAddr("router");
        address attester = makeAddr("attester");
        address owner = makeAddr("owner");
        vm.setEnv("USDT_ADDRESS", vm.toString(usdt));
        vm.setEnv("PAYMENT_ROUTER_ADDRESS", vm.toString(router));
        vm.setEnv("STENMONT_ATTESTER_ADDRESS", vm.toString(attester));
        vm.setEnv("STENMONT_DEPLOYER_ADDRESS", vm.toString(owner));
        vm.setEnv("STENMONT_DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(uint256(0xA11CE))));
        (InvestorRegistry reg, InvoiceClaim claim, ReputationRegistry rep) = new DeployFinancing().run();
        assertEq(reg.attester(), attester);
        assertEq(reg.owner(), owner);
        assertEq(address(claim.registry()), address(reg));
        assertEq(address(claim.router()), router);
        assertEq(address(claim.usdt()), usdt);
        assertEq(claim.owner(), owner);
        assertEq(claim.guardian(), owner);
        assertEq(rep.owner(), owner);
    }
}
