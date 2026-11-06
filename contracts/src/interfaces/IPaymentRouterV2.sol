// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

/// @notice PaymentRouter v2. Differences from v1:
///         - `pay` takes the payout the payer expects, and the token nonce commits to it (payout-bound payments), so
///           neither the relayer nor the API can send a payer's signed money to another account.
///         - Invoices may carry early-payment terms (`discountBps` until `discountUntil`): one payment of the
///           discounted amount inside the window settles the invoice. A sold (hooked) invoice never gets a discount.
///         - Reputation is recorded with the counterparty (the merchant), so distinct suppliers can be counted.
/// @dev Not ABI-compatible with v1: a new deployment, and every contract holding the router address (InvoiceClaim)
///      must be redeployed against it. See docs/ROUTER-V2.md.
interface IPaymentRouterV2 {
    enum Status {
        None,
        Open,
        Paid,
        Cancelled
    }

    struct Invoice {
        address merchant; // signer of the invoice; funds refunds
        address payout; // where payments go (unless `hook` is set); every payer authorization commits to it
        address hook; // optional IClaimPayout that receives payments instead (sold invoice)
        address payerLock; // if non-zero, only this payer may pay (the buyer)
        uint128 amount; // USDT base units (6 decimals)
        uint128 minPayment; // smallest partial payment; the final remainder may be smaller
        uint128 paid; // USDT actually received
        uint128 refunded;
        uint128 discount; // amount waived by an early payment; paid + discount == amount once Paid
        uint64 dueDate; // unix seconds; 0 = no due date
        uint64 discountUntil; // last second (inclusive) the early-payment discount applies; 0 = no discount
        uint16 discountBps; // early-payment discount in basis points; 0 = none
        Status status;
        bytes32 metaHash; // hash of the off-chain invoice document
    }

    /// @dev The invoice id is keccak256(abi.encode(merchant, ref)), the same formula as v1.
    struct CreateInvoice {
        address merchant;
        bytes32 ref;
        address payout;
        address payerLock;
        uint128 amount;
        uint128 minPayment;
        uint64 dueDate;
        uint16 discountBps;
        uint64 discountUntil;
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
    event DiscountTermsSet(bytes32 indexed id, uint16 discountBps, uint64 discountUntil);
    event InvoicePaid(bytes32 indexed id, address indexed payer, uint128 value, uint128 paidTotal, bool fullyPaid);
    /// @notice An early payment settled the invoice; `discount` is the part of the amount waived.
    event InvoiceDiscounted(bytes32 indexed id, address indexed payer, uint128 discount);
    event InvoiceRefunded(bytes32 indexed id, address indexed to, uint128 value, uint128 refundedTotal);
    event InvoiceCancelled(bytes32 indexed id);
    event HookSet(bytes32 indexed id, address indexed hook);
    event CreatorSet(address indexed merchant, address indexed creator, bool allowed);
    event GuardianSet(address indexed guardian);
    event AttesterSet(address indexed attester);
    event RefundApprovalThresholdSet(uint128 threshold);
    event ReputationSet(address indexed reputation);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidInvoice();
    error InvalidDiscount();
    error InvoiceExists();
    error InvoiceNotFound();
    error InvoiceNotOpen();
    error Expired();
    error BadSignature();
    error NotCreator();
    error Overpay();
    error BelowMinimum();
    error WrongPayer();
    error WrongPayout();
    error RefundTooLarge();
    error ApprovalRequired();
    error ApprovalUsed();
    error BadApproval();
    error HookLocked();
    error DiscountActive();
    error NotAContract();
    error NotGuardianOrOwner();
    error InvoiceSold();

    function invoiceIdOf(address merchant, bytes32 ref) external pure returns (bytes32);
    function payNonce(bytes32 id, address payout, bytes32 salt) external pure returns (bytes32);
    function refundNonce(bytes32 id, address to, bytes32 salt) external pure returns (bytes32);
    function invoices(bytes32 id) external view returns (Invoice memory);
    function remaining(bytes32 id) external view returns (uint128);
    function settlementAmount(bytes32 id) external view returns (uint128);
    function isOverdue(bytes32 id) external view returns (bool);

    function createInvoice(CreateInvoice calldata req, bytes calldata merchantSig) external;
    function createInvoiceAsCreator(CreateInvoice calldata req) external;
    function setCreator(address merchant, address creator, bool allowed, uint256 deadline, bytes calldata merchantSig)
        external;
    function setHook(bytes32 id, address hook, uint256 deadline, bytes calldata merchantSig) external;
    function cancel(bytes32 id, uint256 deadline, bytes calldata merchantSig) external;
    function pay(bytes32 id, uint128 value, address payout, Auth calldata a) external;
    function refund(bytes32 id, uint128 value, address to, Auth calldata merchantAuth) external;
    function refundWithApproval(
        bytes32 id,
        uint128 value,
        address to,
        Auth calldata merchantAuth,
        Approval calldata approval
    ) external;
}
