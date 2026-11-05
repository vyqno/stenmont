// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice Implemented by contracts that receive an invoice's payments instead of the merchant (e.g. InvoiceClaim).
interface IClaimPayout {
    /// @dev Called by the router right after `value` USDT was transferred to this contract.
    function onPaid(bytes32 invoiceId, uint128 value) external;
}
