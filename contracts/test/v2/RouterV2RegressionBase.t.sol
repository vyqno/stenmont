// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouterV2} from "../../src/PaymentRouterV2.sol";
import {ReputationRegistryV2} from "../../src/ReputationRegistryV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {BaseV2} from "./BaseV2.t.sol";
import {MockHookV2, ReentrantHookV2} from "./MockHookV2.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract RevertingReputationV2 {
    function record(address, address, uint128, bool) external pure {
        revert("nope");
    }
}

contract GasBurnerReputationV2 {
    function record(address, address, uint128, bool) external pure {
        while (true) {}
    }
}

abstract contract RouterV2RegressionBase is BaseV2 {
    bytes32 internal constant REF1 = keccak256("INV-1");
    bytes32 internal constant REF2 = keccak256("INV-2");
    bytes32 internal constant S1 = keccak256("salt-1");
    bytes32 internal constant S2 = keccak256("salt-2");

    // ================================================================ constructor

    function _usdtDigest(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdt.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        from,
                        address(router),
                        value,
                        validAfter,
                        validBefore,
                        nonce
                    )
                )
            )
        );
    }

    function _wireReputation() internal returns (ReputationRegistryV2 rep) {
        rep = new ReputationRegistryV2(owner);
        vm.startPrank(owner);
        rep.setRecorder(address(router), true);
        router.setReputation(address(rep));
        vm.stopPrank();
    }
}
