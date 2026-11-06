// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title ReputationRegistry
/// @notice A payer's on-chain record: invoices paid in full, how many on time or late, and volume. Only recorders
///         approved by the owner (the PaymentRouter, once it calls this) can write; anyone can read.
contract ReputationRegistry is Ownable2Step {
    struct Record {
        uint32 onTime;
        uint32 late;
        uint128 volume; // USDT base units
    }

    mapping(address subject => Record) private _records;
    mapping(address recorder => bool) public isRecorder;

    event RecorderSet(address indexed recorder, bool allowed);
    event Recorded(address indexed subject, uint128 volume, bool onTime);

    error NotRecorder();
    error ZeroAddress();

    constructor(address owner_) Ownable(owner_) {}

    function recordOf(address subject) external view returns (Record memory) {
        return _records[subject];
    }

    function paidCount(address subject) public view returns (uint256) {
        Record storage r = _records[subject];
        return uint256(r.onTime) + r.late;
    }

    /// @notice 0..100: the share of fully paid invoices that were on time. 0 when there is no history.
    function score(address subject) external view returns (uint256) {
        uint256 n = paidCount(subject);
        return n == 0 ? 0 : (100 * uint256(_records[subject].onTime)) / n;
    }

    function setRecorder(address recorder, bool allowed) external onlyOwner {
        if (recorder == address(0)) revert ZeroAddress();
        isRecorder[recorder] = allowed;
        emit RecorderSet(recorder, allowed);
    }

    /// @notice Records one fully paid invoice for `subject` (the payer).
    function record(address subject, uint128 volume, bool onTime) external {
        if (!isRecorder[msg.sender]) revert NotRecorder();
        Record storage r = _records[subject];
        if (onTime) r.onTime++;
        else r.late++;
        r.volume += volume;
        emit Recorded(subject, volume, onTime);
    }
}
