// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IInvestorRegistry} from "./interfaces/IInvestorRegistry.sol";

/// @title InvestorRegistry
/// @notice The allowlist of accounts that may fund and hold invoice claims. An entry exists only with a signature
///         from the `attester` (who signs after verifying a World ID proof off-chain) and always carries an expiry.
///         The owner can revoke an entry or block an account for good (a blocked account cannot be re-allowed).
contract InvestorRegistry is IInvestorRegistry, EIP712, Ownable2Step {
    bytes32 public constant ALLOW_TYPEHASH =
        keccak256("AllowInvestor(address investor,uint64 expiresAt,uint256 deadline,uint256 nonce)");

    address public attester;
    /// @notice Entry expiry per investor (unix seconds); 0 = never allowed or revoked.
    mapping(address investor => uint64) public allowedUntil;
    mapping(address investor => bool) public blocked;
    /// @notice Per-investor attestation counter; every `allow` uses and increments it, so a signature works once.
    mapping(address investor => uint256) public nonces;

    event InvestorAllowed(address indexed investor, uint64 expiresAt);
    event InvestorRevoked(address indexed investor);
    event InvestorBlocked(address indexed investor, bool blocked);
    event AttesterSet(address indexed attester);

    error ZeroAddress();
    error Expired();
    error BadAttestation();
    error Blocked();

    constructor(address owner_, address attester_) EIP712("Stenmont InvestorRegistry", "1") Ownable(owner_) {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterSet(attester_);
    }

    function isAllowed(address investor) public view returns (bool) {
        return !blocked[investor] && allowedUntil[investor] > block.timestamp;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Anyone may submit an attestation (normally the investor or the relayer).
    /// @param expiresAt when the entry lapses; must be in the future.
    /// @param deadline last second the signature itself can be submitted.
    function allow(address investor, uint64 expiresAt, uint256 deadline, bytes calldata attesterSig) external {
        if (investor == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline || expiresAt <= block.timestamp) revert Expired();
        if (blocked[investor]) revert Blocked();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(ALLOW_TYPEHASH, investor, expiresAt, deadline, nonces[investor])));
        if (!SignatureChecker.isValidSignatureNow(attester, digest, attesterSig)) revert BadAttestation();
        nonces[investor]++;
        allowedUntil[investor] = expiresAt;
        emit InvestorAllowed(investor, expiresAt);
    }

    function revoke(address investor) external onlyOwner {
        allowedUntil[investor] = 0;
        emit InvestorRevoked(investor);
    }

    /// @notice Blocks (or unblocks) an account. A blocked account is never allowed, whatever it holds as an entry.
    function setBlocked(address account, bool isBlocked) external onlyOwner {
        blocked[account] = isBlocked;
        emit InvestorBlocked(account, isBlocked);
    }

    function setAttester(address attester_) external onlyOwner {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterSet(attester_);
    }
}
