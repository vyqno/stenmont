// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Who may hold invoice claims.
interface IInvestorRegistry {
    /// @return true when `investor` has a live (unexpired, unrevoked, unblocked) allowlist entry.
    function isAllowed(address investor) external view returns (bool);
}
