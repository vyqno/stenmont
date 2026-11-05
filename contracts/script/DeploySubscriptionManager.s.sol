// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {SubscriptionManager} from "../src/SubscriptionManager.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Deploys SubscriptionManager. owner = guardian = the deployer wallet for now; move owner to a multisig before real value.
contract DeploySubscriptionManager is Script {
    function run() external returns (SubscriptionManager mgr) {
        address usdt = vm.envAddress("USDT_ADDRESS");
        address owner = vm.envAddress("STENMONT_DEPLOYER_ADDRESS");
        vm.startBroadcast(vm.envUint("STENMONT_DEPLOYER_PRIVATE_KEY"));
        mgr = new SubscriptionManager(usdt, owner, owner);
        vm.stopBroadcast();
    }
}
