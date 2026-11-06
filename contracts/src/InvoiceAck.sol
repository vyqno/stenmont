// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.38;
import {IInvoiceAck} from "./interfaces/IInvoiceAck.sol";
import {IPaymentRouterV2} from "./interfaces/IPaymentRouterV2.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Permanent buyer acknowledgement of receipt, amount, due date and absence of dispute at signing time.
/// @dev Evidence only: does not waive legal defences or guarantee repayment. Anyone may relay the signature.
contract InvoiceAck is EIP712, IInvoiceAck {
    bytes32 public constant ACK_TYPEHASH = keccak256(
        "InvoiceAck(bytes32 invoiceId,uint128 amount,uint64 dueDate,address buyer,uint256 nonce,uint256 deadline)"
    );
    IPaymentRouterV2 public immutable router;
    mapping(address buyer => uint256) public nonces;
    mapping(bytes32 invoiceId => uint256) public ackedAt;
    event InvoiceAcknowledged(bytes32 indexed invoiceId, address indexed buyer, uint128 amount, uint64 dueDate);
    error ZeroAddress();
    error Expired();
    error InvalidInvoice();
    error AlreadyAcknowledged();
    error BadSignature();

    constructor(address router_) EIP712("Stenmont InvoiceAck", "1") {
        if (router_ == address(0)) revert ZeroAddress();
        router = IPaymentRouterV2(router_);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function isEligible(bytes32 invoiceId) external view returns (bool) {
        return ackedAt[invoiceId] != 0;
    }

    function acknowledge(bytes32 invoiceId, uint256 deadline, bytes calldata buyerSig) external {
        if (block.timestamp > deadline) revert Expired();
        if (ackedAt[invoiceId] != 0) revert AlreadyAcknowledged();
        IPaymentRouterV2.Invoice memory inv = router.invoices(invoiceId);
        address buyer = inv.payerLock;
        if (inv.status != IPaymentRouterV2.Status.Open || buyer == address(0) || buyer == inv.merchant) {
            revert InvalidInvoice();
        }
        uint256 nonce = nonces[buyer];
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(ACK_TYPEHASH, invoiceId, inv.amount, inv.dueDate, buyer, nonce, deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(buyer, digest, buyerSig)) revert BadSignature();
        nonces[buyer] = nonce + 1;
        ackedAt[invoiceId] = block.timestamp;
        emit InvoiceAcknowledged(invoiceId, buyer, inv.amount, inv.dueDate);
    }
}
