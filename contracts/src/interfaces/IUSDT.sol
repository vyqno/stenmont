// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice The slice of the official Whitechain USDT (EIP-3009 with ERC-1271 signatures) the router uses.
interface IUSDT {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    /// @dev EIP-2612 with the signature as `bytes`, so smart accounts (ERC-1271) can grant allowances too.
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes calldata signature) external;
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;
}
