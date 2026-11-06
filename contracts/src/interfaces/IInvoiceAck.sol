// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice What InvoiceClaim v2 reads from InvoiceAck.
interface IInvoiceAck {
    /// @return true when the invoice's nominated buyer accepted it AND acknowledged delivery, and never disputed it.
    function isEligible(bytes32 invoiceId) external view returns (bool);
}
