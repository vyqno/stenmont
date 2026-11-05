// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {SignerP256} from "@openzeppelin/contracts/utils/cryptography/signers/SignerP256.sol";
import {SignerWebAuthn} from "@openzeppelin/contracts/utils/cryptography/signers/SignerWebAuthn.sol";

/// @title PasskeyAccount
/// @notice A wallet controlled by a passkey (Face ID, fingerprint, security key): a P-256 key checked with WebAuthn.
///         It only validates signatures (ERC-1271). It has no execute function and no upgrade path, so it can move
///         tokens only through signed token operations such as EIP-3009 authorizations, which the USDT contract
///         verifies by calling `isValidSignature` here.
/// @dev Deployed as minimal-proxy clones of one implementation by PasskeyAccountFactory. The signature is the
///      ABI-encoded `WebAuthn.WebAuthnAuth` (r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON) and the
///      WebAuthn challenge must be the 32-byte hash being signed. User presence and user verification are required, and
///      only low-s signatures are accepted. Digests that reach this contract (token authorizations, router messages)
///      already contain the account address, so a signature for one account is useless for another.
contract PasskeyAccount is SignerWebAuthn, IERC1271 {
    // The P-256 generator point: a valid dummy key so the implementation contract itself can be built and locked.
    bytes32 private constant G_X = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296;
    bytes32 private constant G_Y = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5;

    bool private _initialized;

    error AlreadyInitialized();

    constructor() SignerP256(G_X, G_Y) {
        _initialized = true; // the implementation is never used directly
    }

    /// @notice Sets the passkey's public key. Callable once per clone, atomically by the factory.
    function initialize(bytes32 qx, bytes32 qy) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _setSigner(qx, qy); // reverts if (qx, qy) is not a point on the P-256 curve
    }

    /// @inheritdoc IERC1271
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return _rawSignatureValidation(hash, signature) ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}
