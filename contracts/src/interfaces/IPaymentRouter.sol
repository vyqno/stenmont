// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

interface IPaymentRouter {
    enum Status {
        None,
        Open,
        Paid,
        Cancelled
    }

    struct Invoice {
        address merchant; // signer of the invoice; funds refunds
        address payout; // where payments go (unless `hook` is set)
        address hook; // optional IClaimPayout that receives payments instead (sold invoice)
        address payerLock; // if non-zero, only this payer may pay
        uint128 amount; // USDT base units (6 decimals)
        uint128 minPayment; // smallest partial payment; the final remainder may be smaller
        uint128 paid;
        uint128 refunded;
        uint64 dueDate; // unix seconds; 0 = no due date
        Status status;
        bytes32 metaHash; // hash of the off-chain invoice document
    }

    /// @dev The invoice id is keccak256(abi.encode(merchant, ref)), so nobody can squat another merchant's id.
    struct CreateInvoice {
        address merchant;
        bytes32 ref;
        address payout;
        address payerLock;
        uint128 amount;
        uint128 minPayment;
        uint64 dueDate;
        bytes32 metaHash;
        uint256 deadline;
    }

    /// @dev An EIP-3009 authorization. The token nonce is derived, not chosen: see payNonce / refundNonce.
    struct Auth {
        address payer;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 salt;
        bytes signature;
    }

    /// @dev A human approval signed by the attester (World ID verified off-chain), valid for one operation.
    struct Approval {
        uint256 deadline;
        bytes signature;
    }

    event InvoiceCreated(
        bytes32 indexed id, address indexed merchant, address payout, uint128 amount, uint64 dueDate, bytes32 metaHash
    );
    event InvoicePaid(bytes32 indexed id, address indexed payer, uint128 value, uint128 paidTotal, bool fullyPaid);
    event InvoiceRefunded(bytes32 indexed id, address indexed to, uint128 value, uint128 refundedTotal);
    event InvoiceCancelled(bytes32 indexed id);
    event HookSet(bytes32 indexed id, address indexed hook);
    event CreatorSet(address indexed merchant, address indexed creator, bool allowed);
    event GuardianSet(address indexed guardian);
    event AttesterSet(address indexed attester);
    event RefundApprovalThresholdSet(uint128 threshold);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidInvoice();
    error InvoiceExists();
    error InvoiceNotFound();
    error InvoiceNotOpen();
    error Expired();
    error BadSignature();
    error NotCreator();
    error Overpay();
    error BelowMinimum();
    error WrongPayer();
    error RefundTooLarge();
    error ApprovalRequired();
    error ApprovalUsed();
    error BadApproval();
    error HookLocked();
    error NotAContract();
    error NotGuardianOrOwner();

    function invoiceIdOf(address merchant, bytes32 ref) external pure returns (bytes32);
    function payNonce(bytes32 id, bytes32 salt) external pure returns (bytes32);
    function refundNonce(bytes32 id, address to, bytes32 salt) external pure returns (bytes32);
    function invoices(bytes32 id) external view returns (Invoice memory);
    function remaining(bytes32 id) external view returns (uint128);
    function isOverdue(bytes32 id) external view returns (bool);

    function createInvoice(CreateInvoice calldata req, bytes calldata merchantSig) external;
    function createInvoiceAsCreator(CreateInvoice calldata req) external;
    function setCreator(address merchant, address creator, bool allowed, uint256 deadline, bytes calldata merchantSig)
        external;
    function setHook(bytes32 id, address hook, uint256 deadline, bytes calldata merchantSig) external;
    function cancel(bytes32 id, uint256 deadline, bytes calldata merchantSig) external;
    function pay(bytes32 id, uint128 value, Auth calldata a) external;
    function refund(bytes32 id, uint128 value, address to, Auth calldata merchantAuth) external;
    function refundWithApproval(
        bytes32 id,
        uint128 value,
        address to,
        Auth calldata merchantAuth,
        Approval calldata approval
    ) external;
}
