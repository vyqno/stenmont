// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

interface ISubscriptionManager {
    enum Status {
        None,
        Active,
        Cancelled,
        Completed
    }

    /// @dev Everything the payer agrees to, signed by the payer. `maxCharges` bounds the total ever pulled
    ///      (amount * maxCharges), which is also the allowance the payer grants.
    struct Sub {
        address payer;
        address merchant; // may cancel
        address payout; // receives every charge
        uint128 amount; // per period, USDT base units
        uint32 periodSeconds;
        uint64 startAt; // the first charge is due at this time
        uint32 maxCharges;
    }

    struct State {
        uint64 nextCharge;
        uint32 charges;
        Status status;
    }

    event SubscriptionCreated(
        bytes32 indexed id,
        address indexed payer,
        address indexed merchant,
        address payout,
        uint128 amount,
        uint32 periodSeconds,
        uint64 startAt,
        uint32 maxCharges
    );
    event SubscriptionCharged(bytes32 indexed id, uint128 amount, uint32 charges, uint64 nextCharge);
    event SubscriptionCancelled(bytes32 indexed id, address indexed by);
    event SubscriptionCompleted(bytes32 indexed id);
    event GuardianSet(address indexed guardian);

    error ZeroAddress();
    error InvalidSubscription();
    error SubscriptionExists();
    error NotActive();
    error NotDue();
    error Expired();
    error BadSignature();
    error InsufficientAllowance();
    error NotAuthorized();
    error NotGuardianOrOwner();

    function subscribe(
        bytes32 id,
        Sub calldata s,
        uint256 deadline,
        bytes calldata payerSig,
        uint256 permitValue,
        uint256 permitDeadline,
        bytes calldata permitSig
    ) external;
    function charge(bytes32 id) external;
    function cancel(bytes32 id) external;
    function cancelWithSig(bytes32 id, uint256 deadline, bytes calldata payerSig) external;
    function subscription(bytes32 id) external view returns (Sub memory, State memory);
    function isDue(bytes32 id) external view returns (bool);
}
