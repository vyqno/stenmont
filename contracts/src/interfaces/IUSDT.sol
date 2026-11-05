// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice The slice of the official Whitechain USDT (EIP-3009 with ERC-1271 signatures) the router uses.
interface IUSDT {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
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
