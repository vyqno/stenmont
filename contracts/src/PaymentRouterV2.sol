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
import {IPaymentRouterV2} from "./interfaces/IPaymentRouterV2.sol";
import {IReputationRecorderV2} from "./interfaces/IReputationRecorderV2.sol";
import {IUSDT} from "./interfaces/IUSDT.sol";

/// @title PaymentRouter
/// @notice Invoices and USDT payments for Stenmont. The router never keeps money: every payment and
///         refund is received and forwarded inside one transaction.
/// @dev Customers and merchants sign EIP-3009 authorizations (ERC-1271 smart accounts work). The token nonce is
///      derived from the invoice id, so a relayer cannot redirect a signed payment to another invoice.
contract PaymentRouterV2 is IPaymentRouterV2, EIP712, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant CREATE_INVOICE_TYPEHASH = keccak256(
        "CreateInvoice(address merchant,bytes32 ref,address payout,address payerLock,uint128 amount,uint128 minPayment,uint64 dueDate,uint16 discountBps,uint64 discountUntil,bytes32 metaHash,uint256 deadline)"
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
    /// @notice Optional ReputationRegistry told about every fully paid invoice. Zero = off.
    address public reputation;
    /// @dev Gas given to the reputation call, so a broken registry can neither block nor drain a payment.
    uint256 private constant REPUTATION_GAS = 100_000;

    // slither-disable-next-line uninitialized-state -- written through storage pointers in _create; slither cannot parse OZ's transient guard
    mapping(bytes32 id => Invoice) private _invoices;
    mapping(bytes32 id => mapping(address payer => uint128)) public paidBy;
    mapping(bytes32 id => mapping(address payer => uint128)) public refundedTo;
    mapping(address merchant => mapping(address creator => bool)) public creators;
    mapping(address merchant => uint256) public creatorNonce;
    mapping(bytes32 digest => bool) public usedApprovals;

    constructor(address usdt_, address owner_, address guardian_, address attester_, uint128 refundThreshold_)
        EIP712("Stenmont PaymentRouter", "2")
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
    function payNonce(bytes32 id, address payout, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode("STENMONT_PAY_V2", id, payout, salt));
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

    /// @notice Discount applies only to a single full early payment on an unhooked invoice.
    function settlementAmount(bytes32 id) public view returns (uint128) {
        Invoice storage inv = _invoices[id];
        if (inv.status != Status.Open) return 0;
        if (inv.paid == 0 && inv.hook == address(0) && inv.discountBps != 0 && block.timestamp <= inv.discountUntil) {
            return inv.amount - uint128(uint256(inv.amount) * inv.discountBps / 10_000);
        }
        return inv.amount - inv.paid;
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
                    req.discountBps,
                    req.discountUntil,
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
        if (
            req.discountBps >= 10_000 || (req.discountBps == 0) != (req.discountUntil == 0)
                || (req.discountBps != 0
                    && (req.discountUntil <= block.timestamp || req.dueDate == 0 || req.discountUntil > req.dueDate))
        ) revert InvalidDiscount();
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
        inv.discountBps = req.discountBps;
        inv.discountUntil = req.discountUntil;
        emit DiscountTermsSet(id, req.discountBps, req.discountUntil);
        inv.status = Status.Open;
        emit InvoiceCreated(id, req.merchant, req.payout, req.amount, req.dueDate, req.metaHash);
    }

    // ------------------------------------------------------------------ merchant actions

    /// @dev Only the hook itself may attach (InvoiceClaim.list calls this). Otherwise anyone could copy the merchant's
    ///      SetHook signature out of a pending `list` call and attach the claim to an invoice it never listed, leaving
    ///      an invoice that can be neither paid (the claim refuses unknown invoices) nor cancelled.
    function setHook(bytes32 id, address hook, uint256 deadline, bytes calldata merchantSig) external whenNotPaused {
        Invoice storage inv = _open(id);
        if (msg.sender != hook) revert NotHook();
        if (block.timestamp > deadline) revert Expired();
        if (inv.paid != 0 || inv.hook != address(0)) revert HookLocked();
        if (inv.discountBps != 0) revert DiscountActive();
        if (hook.code.length == 0) revert NotAContract();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SET_HOOK_TYPEHASH, id, hook, deadline)));
        if (!SignatureChecker.isValidSignatureNow(inv.merchant, digest, merchantSig)) revert BadSignature();
        inv.hook = hook;
        emit HookSet(id, hook);
    }

    /// @dev Once an invoice has a payout hook (sold to an investor) only the hook may cancel it, so the merchant
    ///      cannot strand the investor. InvoiceClaim.cancelListing uses this for listed-but-unfunded invoices.
    function cancel(bytes32 id, uint256 deadline, bytes calldata merchantSig) external whenNotPaused {
        Invoice storage inv = _open(id);
        if (inv.hook != address(0) && msg.sender != inv.hook) revert InvoiceSold();
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, id, deadline)));
        if (!SignatureChecker.isValidSignatureNow(inv.merchant, digest, merchantSig)) revert BadSignature();
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    // ------------------------------------------------------------------ pay

    /// @notice Anyone (normally the relayer) can submit a payer's signed authorization.
    function pay(bytes32 id, uint128 value, address payout, Auth calldata a) external whenNotPaused nonReentrant {
        Invoice storage inv = _open(id);
        if (payout != inv.payout) revert WrongPayout();
        if (value == 0) revert ZeroAmount();
        if (inv.payerLock != address(0) && a.payer != inv.payerLock) revert WrongPayer();
        uint128 left = inv.amount - inv.paid;
        uint128 settlement = settlementAmount(id);
        if (value > left) revert Overpay();
        if (value < inv.minPayment && value != left && value != settlement) revert BelowMinimum();

        // effects
        inv.paid += value;
        paidBy[id][a.payer] += value;
        bool full = inv.paid == inv.amount;
        if (!full && value == settlement && inv.paid == value && inv.hook == address(0)) {
            inv.discount = inv.amount - value;
            full = true;
            emit InvoiceDiscounted(id, a.payer, inv.discount);
        }
        if (full) inv.status = Status.Paid;
        emit InvoicePaid(id, a.payer, value, inv.paid, full);

        // interactions
        usdt.receiveWithAuthorization(
            a.payer, address(this), value, a.validAfter, a.validBefore, payNonce(id, inv.payout, a.salt), a.signature
        );
        address hook = inv.hook;
        IERC20(address(usdt)).safeTransfer(hook != address(0) ? hook : inv.payout, value);
        if (hook != address(0)) IClaimPayout(hook).onPaid(id, value);
        if (full && paidBy[id][a.payer] == inv.paid) _recordReputation(a.payer, inv, id);
    }

    /// @dev Fail-safe: a missing, reverting or gas-hungry reputation contract never blocks a payment.
    function _recordReputation(address payer, Invoice storage inv, bytes32 id) private {
        address rep = reputation;
        if (rep == address(0)) return;
        bool onTime = inv.dueDate == 0 || block.timestamp <= inv.dueDate;
        // low-level on purpose: a high-level call reverts on an address without code, outside any try/catch
        // slither-disable-next-line low-level-calls,unchecked-lowlevel -- result deliberately ignored, see above
        rep.call{gas: REPUTATION_GAS}(
            abi.encodeCall(IReputationRecorderV2.record, (payer, inv.merchant, paidBy[id][payer], onTime))
        );
    }

    // ------------------------------------------------------------------ refund

    function refund(bytes32 id, uint128 value, address to, Auth calldata merchantAuth)
        external
        whenNotPaused
        nonReentrant
    {
        // cumulative per invoice, so splitting a big refund into small ones cannot dodge the human approval
        if (uint256(_invoices[id].refunded) + value > refundApprovalThreshold) revert ApprovalRequired();
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

    /// @param reputation_ A ReputationRegistry with this router approved as recorder, or zero to turn it off.
    function setReputation(address reputation_) external onlyOwner {
        reputation = reputation_;
        emit ReputationSet(reputation_);
    }

    // ------------------------------------------------------------------ internal

    function _open(bytes32 id) private view returns (Invoice storage inv) {
        inv = _invoices[id];
        if (inv.status == Status.None) revert InvoiceNotFound();
        if (inv.status != Status.Open) revert InvoiceNotOpen();
    }
}
