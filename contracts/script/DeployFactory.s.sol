// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Deploys the passkey account factory (and, through its constructor, the account implementation).
contract DeployFactory is Script {
    function run() external returns (PasskeyAccountFactory factory) {
        vm.startBroadcast(vm.envUint("STENMONT_DEPLOYER_PRIVATE_KEY"));
        factory = new PasskeyAccountFactory();
        vm.stopBroadcast();
    }
}
