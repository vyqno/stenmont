// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice v2 recorder: every fully paid invoice is recorded with its counterparty (the merchant who was paid), so a
///         reader can count distinct suppliers instead of raw invoices. Not compatible with v1's `record`.
interface IReputationRecorderV2 {
    function record(address subject, address counterparty, uint128 volume, bool onTime) external;
}
