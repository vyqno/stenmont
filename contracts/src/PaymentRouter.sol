// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IClaimPayout} from "./interfaces/IClaimPayout.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";
import {IUSDT} from "./interfaces/IUSDT.sol";

/// @title PaymentRouter
/// @notice Invoices and USDT payments for Stenmont. The router never keeps money: every payment and
///         refund is received and forwarded inside one transaction.
/// @dev Customers and merchants sign EIP-3009 authorizations (ERC-1271 smart accounts work). The token nonce is
///      derived from the invoice id, so a relayer cannot redirect a signed payment to another invoice.
contract PaymentRouter is IPaymentRouter, EIP712, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant CREATE_INVOICE_TYPEHASH = keccak256(
        "CreateInvoice(address merchant,bytes32 ref,address payout,address payerLock,uint128 amount,uint128 minPayment,uint64 dueDate,bytes32 metaHash,uint256 deadline)"
    );
    bytes32 public constant CANCEL_TYPEHASH = keccak256("CancelInvoice(bytes32 id,uint256 deadline)");
    bytes32 public constant SET_HOOK_TYPEHASH = keccak256("SetHook(bytes32 id,address hook,uint256 deadline)");
    bytes32 public constant SET_CREATOR_TYPEHASH =
        keccak256("SetCreator(address merchant,address creator,bool allowed,uint256 deadline,uint256 nonce)");
    bytes32 public constant REFUND_APPROVAL_TYPEHASH = keccak256("RefundApproval(bytes32 opHash,uint256 deadline)");

    IUSDT public immutable usdt;
    address public guardian;
    address public attester;
    /// @notice Refunds above this need a human approval signed by `attester`.
    uint128 public refundApprovalThreshold;

    // slither-disable-next-line uninitialized-state -- written through storage pointers in _create; slither cannot parse OZ's transient guard
    mapping(bytes32 id => Invoice) private _invoices;
    mapping(bytes32 id => mapping(address payer => uint128)) public paidBy;
    mapping(bytes32 id => mapping(address payer => uint128)) public refundedTo;
    mapping(address merchant => mapping(address creator => bool)) public creators;
    mapping(address merchant => uint256) public creatorNonce;
    mapping(bytes32 digest => bool) public usedApprovals;

    constructor(address usdt_, address owner_, address guardian_, address attester_, uint128 refundThreshold_)
        EIP712("Stenmont PaymentRouter", "1")
        Ownable(owner_)
    {
        if (usdt_ == address(0) || guardian_ == address(0) || attester_ == address(0)) revert ZeroAddress();
        usdt = IUSDT(usdt_);
        guardian = guardian_;
        attester = attester_;
        refundApprovalThreshold = refundThreshold_;
        emit GuardianSet(guardian_);
        emit AttesterSet(attester_);
        emit RefundApprovalThresholdSet(refundThreshold_);
    }

    // ------------------------------------------------------------------ views

    function invoiceIdOf(address merchant, bytes32 ref) public pure returns (bytes32) {
        return keccak256(abi.encode(merchant, ref));
    }

    /// @notice The only token nonce `pay` accepts for this invoice and salt.
    function payNonce(bytes32 id, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode("STENMONT_PAY", id, salt));
    }

    /// @notice The only token nonce `refund` accepts for this invoice, recipient and salt.
    function refundNonce(bytes32 id, address to, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode("STENMONT_REFUND", id, to, salt));
    }

    function invoices(bytes32 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    function remaining(bytes32 id) public view returns (uint128) {
        Invoice storage inv = _invoices[id];
        return inv.status == Status.Open ? inv.amount - inv.paid : 0;
    }

    function isOverdue(bytes32 id) external view returns (bool) {
        Invoice storage inv = _invoices[id];
        return inv.status == Status.Open && inv.dueDate != 0 && block.timestamp > inv.dueDate;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ create

    function createInvoice(CreateInvoice calldata req, bytes calldata merchantSig) external whenNotPaused {
        if (block.timestamp > req.deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CREATE_INVOICE_TYPEHASH,
                    req.merchant,
                    req.ref,
                    req.payout,
                    req.payerLock,
                    req.amount,
                    req.minPayment,
                    req.dueDate,
                    req.metaHash,
                    req.deadline
                )
            )
        );
        if (!SignatureChecker.isValidSignatureNow(req.merchant, digest, merchantSig)) revert BadSignature();
        _create(req);
    }

    function createInvoiceAsCreator(CreateInvoice calldata req) external whenNotPaused {
        if (!creators[req.merchant][msg.sender]) revert NotCreator();
        if (block.timestamp > req.deadline) revert Expired();
        _create(req);
    }

    function setCreator(address merchant, address creator, bool allowed, uint256 deadline, bytes calldata merchantSig)
        external
        whenNotPaused
    {
        if (creator == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(SET_CREATOR_TYPEHASH, merchant, creator, allowed, deadline, creatorNonce[merchant]))
        );
        if (!SignatureChecker.isValidSignatureNow(merchant, digest, merchantSig)) revert BadSignature();
        creatorNonce[merchant]++;
        creators[merchant][creator] = allowed;
        emit CreatorSet(merchant, creator, allowed);
    }

    function _create(CreateInvoice calldata req) private {
        if (req.merchant == address(0) || req.payout == address(0)) revert ZeroAddress();
        if (req.amount == 0) revert ZeroAmount();
        if (req.minPayment > req.amount) revert InvalidInvoice();
        bytes32 id = invoiceIdOf(req.merchant, req.ref);
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.None) revert InvoiceExists();

        inv.merchant = req.merchant;
        inv.payout = req.payout;
        inv.payerLock = req.payerLock;
        inv.amount = req.amount;
        inv.minPayment = req.minPayment;
        inv.dueDate = req.dueDate;
        inv.metaHash = req.metaHash;
        inv.status = Status.Open;
        emit InvoiceCreated(id, req.merchant, req.payout, req.amount, req.dueDate, req.metaHash);
    }

    // ------------------------------------------------------------------ merchant actions

    function setHook(bytes32 id, address hook, uint256 deadline, bytes calldata merchantSig) external whenNotPaused {
        Invoice storage inv = _open(id);
        if (block.timestamp > deadline) revert Expired();
        if (inv.paid != 0 || inv.hook != address(0)) revert HookLocked();
        if (hook.code.length == 0) revert NotAContract();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SET_HOOK_TYPEHASH, id, hook, deadline)));
        if (!SignatureChecker.isValidSignatureNow(inv.merchant, digest, merchantSig)) revert BadSignature();
        inv.hook = hook;
        emit HookSet(id, hook);
    }

    function cancel(bytes32 id, uint256 deadline, bytes calldata merchantSig) external whenNotPaused {
        Invoice storage inv = _open(id);
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, id, deadline)));
        if (!SignatureChecker.isValidSignatureNow(inv.merchant, digest, merchantSig)) revert BadSignature();
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    // ------------------------------------------------------------------ pay

    /// @notice Anyone (normally the relayer) can submit a payer's signed authorization.
    function pay(bytes32 id, uint128 value, Auth calldata a) external whenNotPaused nonReentrant {
        Invoice storage inv = _open(id);
        if (value == 0) revert ZeroAmount();
        if (inv.payerLock != address(0) && a.payer != inv.payerLock) revert WrongPayer();
        uint128 left = inv.amount - inv.paid;
        if (value > left) revert Overpay();
        if (value < inv.minPayment && value != left) revert BelowMinimum();

        // effects
        inv.paid += value;
        paidBy[id][a.payer] += value;
        bool full = inv.paid == inv.amount;
        if (full) inv.status = Status.Paid;
        emit InvoicePaid(id, a.payer, value, inv.paid, full);

        // interactions
        usdt.receiveWithAuthorization(
            a.payer, address(this), value, a.validAfter, a.validBefore, payNonce(id, a.salt), a.signature
        );
        address hook = inv.hook;
        IERC20(address(usdt)).safeTransfer(hook != address(0) ? hook : inv.payout, value);
        if (hook != address(0)) IClaimPayout(hook).onPaid(id, value);
    }

    // ------------------------------------------------------------------ refund

    function refund(bytes32 id, uint128 value, address to, Auth calldata merchantAuth)
        external
        whenNotPaused
        nonReentrant
    {
        if (value > refundApprovalThreshold) revert ApprovalRequired();
        _refund(id, value, to, merchantAuth);
    }

    function refundWithApproval(
        bytes32 id,
        uint128 value,
        address to,
        Auth calldata merchantAuth,
        Approval calldata approval
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > approval.deadline) revert Expired();
        bytes32 opHash = keccak256(abi.encode(id, value, to, merchantAuth.salt));
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REFUND_APPROVAL_TYPEHASH, opHash, approval.deadline)));
        if (usedApprovals[digest]) revert ApprovalUsed();
        if (!SignatureChecker.isValidSignatureNow(attester, digest, approval.signature)) revert BadApproval();
        usedApprovals[digest] = true;
        _refund(id, value, to, merchantAuth);
    }

    function _refund(bytes32 id, uint128 value, address to, Auth calldata a) private {
        Invoice storage inv = _invoices[id];
        if (inv.status == Status.None) revert InvoiceNotFound();
        if (a.payer != inv.merchant) revert WrongPayer();
        if (to == address(0)) revert ZeroAddress();
        if (value == 0) revert ZeroAmount();
        if (value > paidBy[id][to] - refundedTo[id][to]) revert RefundTooLarge();

        refundedTo[id][to] += value;
        inv.refunded += value;
        emit InvoiceRefunded(id, to, value, inv.refunded);

        usdt.receiveWithAuthorization(
            a.payer, address(this), value, a.validAfter, a.validBefore, refundNonce(id, to, a.salt), a.signature
        );
        IERC20(address(usdt)).safeTransfer(to, value);
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

    function setAttester(address attester_) external onlyOwner {
        if (attester_ == address(0)) revert ZeroAddress();
        attester = attester_;
        emit AttesterSet(attester_);
    }

    function setRefundApprovalThreshold(uint128 threshold) external onlyOwner {
        refundApprovalThreshold = threshold;
        emit RefundApprovalThresholdSet(threshold);
    }

    // ------------------------------------------------------------------ internal

    function _open(bytes32 id) private view returns (Invoice storage inv) {
        inv = _invoices[id];
        if (inv.status == Status.None) revert InvoiceNotFound();
        if (inv.status != Status.Open) revert InvoiceNotOpen();
    }
}
