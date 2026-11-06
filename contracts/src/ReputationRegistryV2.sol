// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IReputationRecorderV2} from "./interfaces/IReputationRecorderV2.sol";

/// @title ReputationRegistryV2
/// @notice A payer's on-chain record, written only by approved recorders (PaymentRouterV2). Keeps v1's read surface
///         (`recordOf`, `paidCount`, `score`) and adds the one number an underwriter can trust more:
///         `onTimeCounterparties`, the count of DISTINCT counterparties (suppliers) that received at least one fully
///         paid, on-time invoice from the subject. Twenty invoices paid to one supplier, or to one colluding address,
///         count once; paying yourself is refused.
/// @dev Versioned explicitly: `record` takes the counterparty, so v1's `record(address,uint128,bool)` is gone and a v1
///      router cannot write here. Limitation: distinct is not the same as independent. Many addresses controlled by
///      one person still count separately; readers should weight counterparties by their own verification (for
///      example World-verified merchants) using `hasPaidOnTime`.
contract ReputationRegistryV2 is IReputationRecorderV2, Ownable2Step {
    struct Record {
        uint32 onTime;
        uint32 late;
        uint128 volume; // USDT base units
    }

    mapping(address subject => Record) private _records;
    /// @notice Number of distinct counterparties with at least one on-time, fully paid invoice from `subject`.
    mapping(address subject => uint32) public onTimeCounterparties;
    /// @notice Whether `subject` has paid `counterparty` in full and on time at least once.
    mapping(address subject => mapping(address counterparty => bool)) public hasPaidOnTime;
    mapping(address recorder => bool) public isRecorder;

    event RecorderSet(address indexed recorder, bool allowed);
    event Recorded(address indexed subject, address indexed counterparty, uint128 volume, bool onTime);
    event CounterpartyAdded(address indexed subject, address indexed counterparty, uint32 total);

    error NotRecorder();
    error ZeroAddress();
    error SelfDealing();

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

    /// @inheritdoc IReputationRecorderV2
    function record(address subject, address counterparty, uint128 volume, bool onTime) external {
        if (!isRecorder[msg.sender]) revert NotRecorder();
        if (subject == address(0) || counterparty == address(0)) revert ZeroAddress();
        if (subject == counterparty) revert SelfDealing();
        Record storage r = _records[subject];
        if (onTime) r.onTime++;
        else r.late++;
        r.volume += volume;
        emit Recorded(subject, counterparty, volume, onTime);
        if (onTime && !hasPaidOnTime[subject][counterparty]) {
            hasPaidOnTime[subject][counterparty] = true;
            uint32 total = ++onTimeCounterparties[subject];
            emit CounterpartyAdded(subject, counterparty, total);
        }
    }
}
