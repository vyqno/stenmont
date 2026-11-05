// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PasskeyAccount} from "./PasskeyAccount.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/// @title PasskeyAccountFactory
/// @notice Creates PasskeyAccount clones at addresses that are known before they exist (CREATE2), so a payer can be
///         funded and can sign before anything is deployed. The public key is part of the address, so nobody can
///         deploy "your" address with a different key. Creation is permissionless; the relayer pays for it on first use.
contract PasskeyAccountFactory {
    address public immutable implementation;

    event AccountCreated(address indexed account, bytes32 qx, bytes32 qy, bytes32 salt);

    constructor() {
        implementation = address(new PasskeyAccount());
    }

    /// @notice The address of the account for this key and salt, whether or not it has been deployed yet.
    function getAddress(bytes32 qx, bytes32 qy, bytes32 salt) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(qx, qy, salt));
    }

    /// @notice Deploys and initializes the account, or returns the existing one.
    function createAccount(bytes32 qx, bytes32 qy, bytes32 salt) external returns (address account) {
        account = getAddress(qx, qy, salt);
        if (account.code.length != 0) return account;
        account = Clones.cloneDeterministic(implementation, _salt(qx, qy, salt));
        emit AccountCreated(account, qx, qy, salt);
        PasskeyAccount(account).initialize(qx, qy);
    }

    function _salt(bytes32 qx, bytes32 qy, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(qx, qy, salt));
    }
}
