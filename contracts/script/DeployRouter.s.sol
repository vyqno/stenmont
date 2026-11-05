// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouter} from "../src/PaymentRouter.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Deploys PaymentRouter. Reads configuration from the environment (see .env.example).
///         owner = guardian = the deployer wallet for now; move owner to a multisig before any real value.
contract DeployRouter is Script {
    uint128 internal constant DEFAULT_REFUND_APPROVAL_THRESHOLD = 100e6; // 100 USDT

    function run() external returns (PaymentRouter router) {
        address usdt = vm.envAddress("USDT_ADDRESS");
        address owner = vm.envAddress("STENMONT_DEPLOYER_ADDRESS");
        address attester = vm.envAddress("STENMONT_ATTESTER_ADDRESS");
        uint128 threshold = uint128(vm.envOr("REFUND_APPROVAL_THRESHOLD", uint256(DEFAULT_REFUND_APPROVAL_THRESHOLD)));

        vm.startBroadcast(vm.envUint("STENMONT_DEPLOYER_PRIVATE_KEY"));
        router = new PaymentRouter(usdt, owner, owner, attester, threshold);
        vm.stopBroadcast();
    }
}
