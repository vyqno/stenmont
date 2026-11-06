// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {ISubscriptionManager} from "./interfaces/ISubscriptionManager.sol";
import {IUSDT} from "./interfaces/IUSDT.sol";

/// @title SubscriptionManager
/// @notice Recurring payments a customer signs once and can end any time. The merchant (or anyone, usually the relayer)
///         can pull the agreed amount each period, but only to the agreed payout, only once per period, and never more
///         than `amount * maxCharges` in total. The manager never holds money: every charge goes payer to payout in one
///         transferFrom.
/// @dev Smart accounts (ERC-1271), including passkey accounts, can subscribe and cancel. A customer who falls behind is
///      charged once when they catch up: missed periods are skipped, never billed together.
contract SubscriptionManager is ISubscriptionManager, EIP712, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant SUBSCRIBE_TYPEHASH = keccak256(
        "Subscribe(bytes32 id,address payer,address merchant,address payout,uint128 amount,uint32 periodSeconds,uint64 startAt,uint32 maxCharges,uint256 deadline)"
    );
    bytes32 public constant CANCEL_TYPEHASH = keccak256("CancelSubscription(bytes32 id,uint256 deadline)");

    bytes32 public constant MERCHANT_CANCEL_TYPEHASH =
        keccak256("MerchantCancelSubscription(bytes32 id,uint256 deadline)");

    /// @notice Shortest allowed period (kept low so demos can run in minutes).
    uint32 public constant MIN_PERIOD = 60;
    /// @notice The most charges one signature can commit a customer to.
    uint32 public constant MAX_CHARGES_CAP = 10_000;
    /// @notice How far in the future the first charge may be.
    uint64 public constant MAX_START_AHEAD = 366 days;

    IUSDT public immutable usdt;
    address public guardian;

    mapping(bytes32 id => Sub) private _subs;
    mapping(bytes32 id => State) private _state;

    constructor(address usdt_, address owner_, address guardian_)
        EIP712("Stenmont SubscriptionManager", "1")
        Ownable(owner_)
    {
        if (usdt_ == address(0) || guardian_ == address(0)) {
            revert ZeroAddress();
        }
        usdt = IUSDT(usdt_);
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    // ------------------------------------------------------------------ views

    function subscription(bytes32 id) external view returns (Sub memory, State memory) {
        return (_subs[id], _state[id]);
    }

    function isDue(bytes32 id) external view returns (bool) {
        State storage st = _state[id];
        return st.status == Status.Active && block.timestamp >= st.nextCharge;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ subscribe

    /// @param deadline Until when the payer's signature is valid.
    /// @param permitValue The allowance the payer's EIP-2612 permit sets. A permit SETS (not adds to) the allowance, so a
    ///        payer with other subscriptions signs "current allowance + this cap". It must end up at least `amount * maxCharges`.
    /// @param permitSig Optional permit; leave empty if the allowance already exists.
    function subscribe(
        bytes32 id,
        Sub calldata s,
        uint256 deadline,
        bytes calldata payerSig,
        uint256 permitValue,
        uint256 permitDeadline,
        bytes calldata permitSig
    ) external whenNotPaused {
        if (block.timestamp > deadline) revert Expired();
        if (s.payer == address(0) || s.merchant == address(0) || s.payout == address(0)) revert ZeroAddress();
        if (
            s.amount == 0 || s.periodSeconds < MIN_PERIOD || s.maxCharges == 0 || s.maxCharges > MAX_CHARGES_CAP
                || s.startAt > block.timestamp + MAX_START_AHEAD
        ) revert InvalidSubscription();
        if (_state[id].status != Status.None) revert SubscriptionExists();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SUBSCRIBE_TYPEHASH,
                    id,
                    s.payer,
                    s.merchant,
                    s.payout,
                    s.amount,
                    s.periodSeconds,
                    s.startAt,
                    s.maxCharges,
                    deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(s.payer, digest, payerSig)) revert BadSignature();

        _subs[id] = s;
        _state[id] = State({nextCharge: s.startAt, charges: 0, status: Status.Active});
        emit SubscriptionCreated(id, s.payer, s.merchant, s.payout, s.amount, s.periodSeconds, s.startAt, s.maxCharges);

        // What the payer signed bounds every charge, whatever the allowance is. A griefer who front-runs the permit
        // burns its nonce, so a failing permit is not an error by itself: what matters is that the allowance is there.
        uint256 cap = uint256(s.amount) * s.maxCharges;
        if (permitSig.length != 0) {
            try usdt.permit(s.payer, address(this), permitValue, permitDeadline, permitSig) {} catch {}
        }
        if (usdt.allowance(s.payer, address(this)) < cap) revert InsufficientAllowance();
    }

    // ------------------------------------------------------------------ charge

    /// @notice Pulls one period's amount from the payer to the payout. Anyone may call it; it only works when due.
    function charge(bytes32 id) external whenNotPaused nonReentrant {
        State storage st = _state[id];
        if (st.status != Status.Active) revert NotActive();
        if (block.timestamp < st.nextCharge) revert NotDue();
        Sub storage s = _subs[id];

        uint64 due = st.nextCharge;
        uint32 n = ++st.charges;
        // on time (or a little late): stay on the schedule. A full period late or more: no catch-up, restart from now.
        // `>=` matters: at exactly one period late the next charge would equal now and be due again immediately.
        uint64 next = block.timestamp >= uint256(due) + s.periodSeconds
            ? uint64(block.timestamp + s.periodSeconds)
            : due + s.periodSeconds;
        st.nextCharge = next;
        emit SubscriptionCharged(id, s.amount, n, next);
        if (n == s.maxCharges) {
            st.status = Status.Completed;
            emit SubscriptionCompleted(id);
        }

        // `s.payer` is not arbitrary: it is only ever written in `subscribe`, after the payer's own signature over
        // these exact terms was verified, and the pull is bounded by amount, payout, schedule and maxCharges.
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(address(usdt)).safeTransferFrom(s.payer, s.payout, s.amount);
    }

    // ------------------------------------------------------------------ cancel (works even while paused)

    /// @notice The payer or the merchant ends the subscription.
    function cancel(bytes32 id) external {
        State storage st = _state[id];
        if (st.status != Status.Active) revert NotActive();
        Sub storage s = _subs[id];
        if (msg.sender != s.payer && msg.sender != s.merchant) revert NotAuthorized();
        st.status = Status.Cancelled;
        emit SubscriptionCancelled(id, msg.sender);
    }

    /// @notice The payer ends it with a signature, so a relayer can submit it (passkey accounts have no way to send a transaction).
    function cancelWithSig(bytes32 id, uint256 deadline, bytes calldata payerSig) external {
        if (block.timestamp > deadline) revert Expired();
        State storage st = _state[id];
        if (st.status != Status.Active) revert NotActive();
        address payer = _subs[id].payer;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, id, deadline)));
        if (!SignatureChecker.isValidSignatureNow(payer, digest, payerSig)) revert BadSignature();
        st.status = Status.Cancelled;
        emit SubscriptionCancelled(id, payer);
    }

    /// @notice The merchant ends it with a signature (a passkey merchant account cannot send a transaction). A separate
    ///         typehash keeps a payer's cancel signature from being replayed as the merchant's. Single use: the
    ///         subscription is no longer Active afterwards, so the signature cannot be replayed.
    function cancelWithMerchantSig(bytes32 id, uint256 deadline, bytes calldata merchantSig) external {
        if (block.timestamp > deadline) revert Expired();
        State storage st = _state[id];
        if (st.status != Status.Active) revert NotActive();
        address merchant = _subs[id].merchant;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(MERCHANT_CANCEL_TYPEHASH, id, deadline)));
        if (!SignatureChecker.isValidSignatureNow(merchant, digest, merchantSig)) revert BadSignature();
        st.status = Status.Cancelled;
        emit SubscriptionCancelled(id, merchant);
    }

    // ------------------------------------------------------------------ admin

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert ZeroAddress();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }
}
