// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

interface IReputationRecorder {
    function record(address subject, uint128 volume, bool onTime) external;
}
