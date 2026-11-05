// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {DeployRouter} from "../script/DeployRouter.s.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {Test} from "forge-std/Test.sol";

/// @dev One test, run sequentially: environment variables are process-wide, so separate tests would race.
contract DeployRouterTest is Test {
    function test_deploy_wiresRolesAndThreshold_andDefaultsTo100USDT() public {
        address usdt = makeAddr("usdt");
        address owner = makeAddr("owner");
        address attester = makeAddr("attester");
        vm.setEnv("USDT_ADDRESS", vm.toString(usdt));
        vm.setEnv("STENMONT_DEPLOYER_ADDRESS", vm.toString(owner));
        vm.setEnv("STENMONT_ATTESTER_ADDRESS", vm.toString(attester));
        vm.setEnv("STENMONT_DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(uint256(0xA11CE))));

        // explicit threshold
        vm.setEnv("REFUND_APPROVAL_THRESHOLD", "250000000");
        PaymentRouter router = new DeployRouter().run();
        assertEq(address(router.usdt()), usdt);
        assertEq(router.owner(), owner);
        assertEq(router.guardian(), owner);
        assertEq(router.attester(), attester);
        assertEq(router.refundApprovalThreshold(), 250e6);

        // unset: falls back to the 100 USDT default
        vm.setEnv("REFUND_APPROVAL_THRESHOLD", "");
        assertEq(new DeployRouter().run().refundApprovalThreshold(), 100e6);
    }
}
