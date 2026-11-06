// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.38;

import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {InvoiceAck} from "../src/InvoiceAck.sol";
import {InvoiceClaimV2} from "../src/InvoiceClaimV2.sol";
import {PaymentRouterV2} from "../src/PaymentRouterV2.sol";
import {ReputationRegistryV2} from "../src/ReputationRegistryV2.sol";
import {SubscriptionManager} from "../src/SubscriptionManager.sol";
import {Script} from "forge-std/Script.sol";

/// @notice Testnet-only fresh set. Dry run without --broadcast first; never updates manifests or application env.
/// @dev Owner must be the signer to wire fresh reputation. No merchant delegation or investor allowlist is granted.
contract DeployV2 is Script {
    address public constant OFFICIAL_USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;

    struct Config {
        address usdt;
        address owner;
        address guardian;
        address attester;
        uint128 refundThreshold;
    }

    struct Deployment {
        InvestorRegistry registry;
        PaymentRouterV2 router;
        SubscriptionManager subscriptions;
        InvoiceClaimV2 claim;
        InvoiceAck ack;
        ReputationRegistryV2 reputation;
    }

    function validate(Config memory c, address deployer) public view {
        require(block.chainid == 1874, "testnet chain only");
        require(c.usdt == OFFICIAL_USDT, "official test USDT only");
        require(c.usdt.code.length != 0, "USDT code missing");
        require(c.owner != address(0) && c.guardian != address(0) && c.attester != address(0), "zero role");
        require(c.owner == deployer, "deployer must own wiring");
        require(c.refundThreshold == 2_000_000, "API threshold mismatch");
    }

    function run() external returns (Deployment memory d) {
        // Public guards run before key access and before startBroadcast, including on a mistaken mainnet RPC.
        require(block.chainid == 1874, "testnet chain only");
        Config memory c = Config(
            vm.envAddress("USDT_ADDRESS"),
            vm.envAddress("STENMONT_DEPLOYER_ADDRESS"),
            vm.envAddress("STENMONT_GUARDIAN_ADDRESS"),
            vm.envAddress("STENMONT_ATTESTER_ADDRESS"),
            2_000_000
        );
        // Reject unit confusion: API/contract threshold is USDT base units, never decimal dollars.
        require(vm.envUint("REFUND_APPROVAL_THRESHOLD") == c.refundThreshold, "API threshold mismatch");
        uint256 privateKey = vm.envUint("STENMONT_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        validate(c, deployer);
        uint256 nonce = vm.getNonce(deployer);
        address expectedRegistry = vm.computeCreateAddress(deployer, nonce);
        address expectedRouter = vm.computeCreateAddress(deployer, nonce + 1);
        address expectedSubscriptions = vm.computeCreateAddress(deployer, nonce + 2);
        address expectedClaim = vm.computeCreateAddress(deployer, nonce + 3);
        address expectedAck = vm.computeCreateAddress(deployer, nonce + 4);
        address expectedReputation = vm.computeCreateAddress(deployer, nonce + 5);
        vm.startBroadcast(privateKey);
        d = _deploy(c);
        vm.stopBroadcast();
        require(
            address(d.registry) == expectedRegistry && address(d.router) == expectedRouter, "deployment nonce changed"
        );
        require(
            address(d.subscriptions) == expectedSubscriptions && address(d.claim) == expectedClaim,
            "deployment nonce changed"
        );
        require(
            address(d.ack) == expectedAck && address(d.reputation) == expectedReputation, "deployment nonce changed"
        );
        _verify(c, d);
    }

    function _deploy(Config memory c) internal returns (Deployment memory d) {
        d.registry = new InvestorRegistry(c.owner, c.attester);
        d.router = new PaymentRouterV2(c.usdt, c.owner, c.guardian, c.attester, c.refundThreshold);
        d.subscriptions = new SubscriptionManager(c.usdt, c.owner, c.guardian);
        d.claim = new InvoiceClaimV2(c.usdt, address(d.router), address(d.registry), c.owner, c.guardian);
        d.ack = new InvoiceAck(address(d.router));
        d.reputation = new ReputationRegistryV2(c.owner);
        d.reputation.setRecorder(address(d.router), true);
        d.router.setReputation(address(d.reputation));
    }

    function _domain(string memory name, string memory version, address target) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                target
            )
        );
    }

    function _verify(Config memory c, Deployment memory d) internal view {
        require(d.registry.owner() == c.owner && d.registry.attester() == c.attester, "registry roles");
        require(
            d.router.owner() == c.owner && d.router.guardian() == c.guardian && d.router.attester() == c.attester,
            "router roles"
        );
        require(
            d.router.refundApprovalThreshold() == c.refundThreshold && address(d.router.usdt()) == c.usdt,
            "router policy"
        );
        require(d.claim.owner() == c.owner && d.claim.guardian() == c.guardian, "claim roles");
        require(
            address(d.claim.router()) == address(d.router) && address(d.claim.registry()) == address(d.registry)
                && address(d.claim.usdt()) == c.usdt,
            "claim wiring"
        );
        require(address(d.ack.router()) == address(d.router), "ack wiring");
        require(
            d.reputation.owner() == c.owner && d.reputation.isRecorder(address(d.router))
                && d.router.reputation() == address(d.reputation),
            "reputation wiring"
        );
        require(
            d.subscriptions.owner() == c.owner && d.subscriptions.guardian() == c.guardian
                && address(d.subscriptions.usdt()) == c.usdt,
            "subscription roles"
        );
        require(
            d.router.domainSeparator() == _domain("Stenmont PaymentRouter", "2", address(d.router)), "router domain"
        );
        require(d.claim.domainSeparator() == _domain("Stenmont InvoiceClaim", "2", address(d.claim)), "claim domain");
        require(d.ack.domainSeparator() == _domain("Stenmont InvoiceAck", "1", address(d.ack)), "ack domain");
    }
}
