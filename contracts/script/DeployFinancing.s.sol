// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {InvoiceClaim} from "../src/InvoiceClaim.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Deploys the Phase 7 contracts against an existing router. owner = guardian = the deployer wallet for now;
///         move ownership to a multisig before real value. Reads PAYMENT_ROUTER_ADDRESS, USDT_ADDRESS and
///         STENMONT_ATTESTER_ADDRESS (the key that signs World-verified investor attestations).
contract DeployFinancing is Script {
    function run() external returns (InvestorRegistry registry, InvoiceClaim claim, ReputationRegistry reputation) {
        address usdt = vm.envAddress("USDT_ADDRESS");
        address router = vm.envAddress("PAYMENT_ROUTER_ADDRESS");
        address attester = vm.envAddress("STENMONT_ATTESTER_ADDRESS");
        address owner = vm.envAddress("STENMONT_DEPLOYER_ADDRESS");
        vm.startBroadcast(vm.envUint("STENMONT_DEPLOYER_PRIVATE_KEY"));
        registry = new InvestorRegistry(owner, attester);
        claim = new InvoiceClaim(usdt, router, address(registry), owner, owner);
        reputation = new ReputationRegistry(owner);
        vm.stopBroadcast();
    }
}
