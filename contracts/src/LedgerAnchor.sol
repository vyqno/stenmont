// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.38;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Immutable merchant-authorized period commitments. A root commits to supplied bytes, not accounting truth.
contract LedgerAnchor is EIP712 {
    struct Anchor {
        bytes32 root;
        uint256 lineCount;
    }
    bytes32 public constant ANCHOR_TYPEHASH = keccak256(
        "Anchor(address merchant,bytes32 periodId,bytes32 root,uint256 lineCount,uint256 nonce,uint256 deadline)"
    );
    mapping(address merchant => uint256) public nonces;
    mapping(address merchant => mapping(bytes32 periodId => Anchor)) public anchors;
    event Anchored(address indexed merchant, bytes32 indexed periodId, bytes32 root, uint256 lineCount, uint256 nonce);
    error InvalidAnchor();
    error Expired();
    error AlreadyAnchored();
    error BadSignature();
    constructor() EIP712("Stenmont LedgerAnchor", "1") {}

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function anchor(
        address merchant,
        bytes32 periodId,
        bytes32 root,
        uint256 lineCount,
        uint256 deadline,
        bytes calldata merchantSig
    ) external {
        if (block.timestamp > deadline) revert Expired();
        if (merchant == address(0) || root == bytes32(0) || lineCount == 0) revert InvalidAnchor();
        if (anchors[merchant][periodId].root != bytes32(0)) revert AlreadyAnchored();
        uint256 nonce = nonces[merchant];
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(ANCHOR_TYPEHASH, merchant, periodId, root, lineCount, nonce, deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(merchant, digest, merchantSig)) revert BadSignature();
        nonces[merchant] = nonce + 1;
        anchors[merchant][periodId] = Anchor(root, lineCount);
        emit Anchored(merchant, periodId, root, lineCount, nonce);
    }
}
