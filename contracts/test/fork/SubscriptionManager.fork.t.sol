// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {SubscriptionManager} from "../../src/SubscriptionManager.sol";
import {ISubscriptionManager} from "../../src/interfaces/ISubscriptionManager.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {Test} from "forge-std/Test.sol";

interface IRealUSDTPermit {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function allowance(address, address) external view returns (uint256);
    function nonces(address) external view returns (uint256);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @dev Subscriptions against the REAL Whitechain USDT at a pinned block: permit(bytes) and transferFrom as deployed.
///      forge test --profile fork
contract SubscriptionManagerForkTest is Test {
    IRealUSDTPermit internal constant USDT = IRealUSDTPermit(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address internal constant WHALE = 0xc4b02aE9603D3d9CD5653760dbdF337F6c552c0A;
    uint256 internal constant PINNED_BLOCK = 12_308_524;
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    SubscriptionManager internal mgr;
    uint256 internal payerPk = 0xCAFE01;
    address internal payer;
    address internal payout = address(0x9A70);
    address internal merchant = address(0x3E4C);

    function setUp() public {
        vm.createSelectFork(vm.envOr("WHITECHAIN_RPC", string("https://rpc.testnet.whitechain.io")), PINNED_BLOCK);
        payer = vm.addr(payerPk);
        mgr = new SubscriptionManager(address(USDT), address(0xA1), address(0xA2));
        vm.prank(WHALE);
        USDT.transfer(payer, 20e6);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _permit(uint256 pk, address from, uint256 value, uint256 deadline) internal view returns (bytes memory) {
        return _sig(
            pk,
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    USDT.DOMAIN_SEPARATOR(),
                    keccak256(abi.encode(PERMIT_TYPEHASH, from, address(mgr), value, USDT.nonces(from), deadline))
                )
            )
        );
    }

    function _subscribe(address from, bytes32 id, uint256 signerPk) internal {
        ISubscriptionManager.Sub memory s = ISubscriptionManager.Sub({
            payer: from,
            merchant: merchant,
            payout: payout,
            amount: 2e6,
            periodSeconds: 30 days,
            startAt: uint64(block.timestamp),
            maxCharges: 3
        });
        uint256 deadline = block.timestamp + 1 days;
        bytes32 structHash = keccak256(
            abi.encode(
                mgr.SUBSCRIBE_TYPEHASH(),
                id,
                s.payer,
                s.merchant,
                s.payout,
                s.amount,
                s.periodSeconds,
                s.startAt,
                s.maxCharges,
                deadline
            )
        );
        bytes memory subSig = _sig(signerPk, keccak256(abi.encodePacked("\x19\x01", mgr.domainSeparator(), structHash)));
        uint256 permitValue = uint256(s.amount) * s.maxCharges;
        mgr.subscribe(id, s, deadline, subSig, permitValue, deadline, _permit(signerPk, from, permitValue, deadline));
    }

    function test_fork_subscribeAndChargeOnTheRealToken() public {
        _subscribe(payer, keccak256("sub-1"), payerPk);
        assertEq(USDT.allowance(payer, address(mgr)), 6e6); // exactly amount * maxCharges
        mgr.charge(keccak256("sub-1"));
        assertEq(USDT.balanceOf(payout), 2e6);
        assertEq(USDT.balanceOf(payer), 18e6);
        assertEq(USDT.balanceOf(address(mgr)), 0);
        assertEq(USDT.allowance(payer, address(mgr)), 4e6);

        vm.warp(block.timestamp + 30 days);
        mgr.charge(keccak256("sub-1"));
        assertEq(USDT.balanceOf(payout), 4e6);
    }

    function test_fork_smartAccountPayerCanPermitAndSubscribeOnTheRealToken() public {
        MockWallet wallet = new MockWallet(payer);
        vm.prank(WHALE);
        USDT.transfer(address(wallet), 10e6);
        _subscribe(address(wallet), keccak256("sub-2"), payerPk);
        mgr.charge(keccak256("sub-2"));
        assertEq(USDT.balanceOf(payout), 2e6);
        assertEq(USDT.balanceOf(address(wallet)), 8e6);
    }

    function test_fork_aPayerWhoRunsOutOfFundsIsSkippedCleanlyThenCharged() public {
        _subscribe(payer, keccak256("sub-3"), payerPk);
        vm.prank(payer);
        USDT.transfer(address(0xdead), 20e6);
        vm.expectRevert();
        mgr.charge(keccak256("sub-3"));
        vm.prank(WHALE);
        USDT.transfer(payer, 5e6);
        mgr.charge(keccak256("sub-3"));
        assertEq(USDT.balanceOf(payout), 2e6);
    }
}
