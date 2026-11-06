// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IClaimPayout} from "./interfaces/IClaimPayout.sol";
import {IInvestorRegistry} from "./interfaces/IInvestorRegistry.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";
import {IUSDT} from "./interfaces/IUSDT.sol";

/// @title InvoiceClaim
/// @notice Sell an invoice for cash today. The merchant lists an open, unpaid invoice at a discount with a reserve; an
///         allowlisted investor funds it and receives an ERC-721 (token id = invoice id). From then on the router pays
///         every customer payment to this contract, which forwards it to the token holder. The token can only move
///         between allowlisted accounts and is frozen once settled.
/// @dev Money flow. fund: investor pays `price`; the merchant gets `price - reserve` at once; `reserve` stays here.
///      Payments (router -> onPaid) go to the holder until the holder has received `face`, then (Funded) the reserve
///      is released to the merchant and the claim is Settled. If unpaid `GRACE` after the due date, anyone may call
///      markDefault: the reserve goes to the holder, capped so the holder never receives more than `face`. Late
///      payments after a default still go to the holder up to that cap; the rest goes to the merchant.
///      A payout that the token refuses (e.g. a blocklisted recipient) never reverts the customer's payment: it is
///      credited to `pending` and the recipient pulls it with `withdrawPending`.
///      Only the merchant's reserve (and `pending`) is ever held here; nothing else stays after a call.
contract InvoiceClaim is IClaimPayout, ERC721, EIP712, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    enum ClaimStatus {
        None,
        Listed,
        Funded,
        Settled,
        Defaulted,
        Cancelled // payment arrived while merely listed, so the invoice can no longer be sold
    }

    struct Claim {
        address payee; // the invoice's payout address: receives the advance, the reserve back, and any remainder
        uint128 face; // the invoice amount
        uint128 price; // what the investor pays
        uint128 reserve; // part of `price` the merchant leaves here as the investor's first-loss cover
        uint128 received; // total the router has paid in
        uint128 toHolder; // total forwarded to holders (payments + reserve on default); never exceeds `face`
        uint64 dueDate;
        uint64 fundBy; // listing expires at this time
        ClaimStatus status;
    }

    bytes32 public constant TERMS_TYPEHASH =
        keccak256("ClaimTerms(bytes32 invoiceId,uint16 discountBps,uint16 reserveBps,uint256 deadline)");
    uint256 public constant BPS = 10_000;
    uint64 public constant GRACE = 7 days;

    IUSDT public immutable usdt;
    IPaymentRouter public immutable router;
    IInvestorRegistry public immutable registry;
    address public guardian;

    // slither-disable-next-line uninitialized-state -- written through storage pointers; slither cannot parse OZ's transient guard
    mapping(bytes32 invoiceId => Claim) private _claims;
    /// @notice Payouts the token refused, waiting to be pulled.
    mapping(address account => uint256) public pending;
    uint256 public totalPending;

    event ClaimListed(
        bytes32 indexed invoiceId,
        address indexed merchant,
        uint128 face,
        uint128 price,
        uint128 reserve,
        uint64 dueDate
    );
    event ClaimFunded(bytes32 indexed invoiceId, address indexed investor, uint128 price, uint128 advance);
    event ClaimPaid(bytes32 indexed invoiceId, address indexed holder, uint128 toHolder, uint128 toPayee);
    event ClaimSettled(bytes32 indexed invoiceId, uint128 reserveReleased);
    event ClaimDefaulted(bytes32 indexed invoiceId, address indexed holder, uint128 reserveToHolder);
    event ClaimCancelled(bytes32 indexed invoiceId);
    event PayoutDeferred(address indexed account, uint256 amount);
    event PendingWithdrawn(address indexed account, address indexed to, uint256 amount);
    event GuardianSet(address indexed guardian);

    error ZeroAddress();
    error ZeroAmount();
    error NotRouter();
    error NotGuardianOrOwner();
    error Expired();
    error BadSignature();
    error BadTerms();
    error InvoiceNotSellable();
    error AlreadyListed();
    error NotListed();
    error NotFunded();
    error NotAllowlisted();
    error TransferLocked();
    error GraceNotOver();
    error NothingPending();

    constructor(address usdt_, address router_, address registry_, address owner_, address guardian_)
        ERC721("Stenmont Invoice Claim", "SCLAIM")
        EIP712("Stenmont InvoiceClaim", "1")
        Ownable(owner_)
    {
        if (usdt_ == address(0) || router_ == address(0) || registry_ == address(0) || guardian_ == address(0)) {
            revert ZeroAddress();
        }
        usdt = IUSDT(usdt_);
        router = IPaymentRouter(router_);
        registry = IInvestorRegistry(registry_);
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    // ------------------------------------------------------------------ views

    function claims(bytes32 invoiceId) external view returns (Claim memory) {
        return _claims[invoiceId];
    }

    /// @notice The only token nonce `fund` accepts for this invoice and salt (a signed funding cannot be redirected).
    function fundNonce(bytes32 invoiceId, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode("STENMONT_FUND", invoiceId, salt));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice price = face * (10000 - discountBps) / 10000, reserve = face * reserveBps / 10000 (both round down).
    function quote(uint128 face, uint16 discountBps, uint16 reserveBps)
        public
        pure
        returns (uint128 price, uint128 reserve)
    {
        if (discountBps >= BPS || uint256(discountBps) + reserveBps > BPS) revert BadTerms();
        price = uint128((uint256(face) * (BPS - discountBps)) / BPS);
        reserve = uint128((uint256(face) * reserveBps) / BPS);
    }

    // ------------------------------------------------------------------ list

    /// @notice Offers an invoice for sale. Needs the merchant's signature over the terms and over the router's SetHook
    ///         (so the router sends this invoice's payments here). Reverts unless the invoice is open, unpaid, has a
    ///         future due date and no hook yet. `deadline` is also the last moment an investor may fund.
    function list(
        bytes32 invoiceId,
        uint16 discountBps,
        uint16 reserveBps,
        uint256 deadline,
        bytes calldata termsSig,
        bytes calldata hookSig
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        Claim storage c = _claims[invoiceId];
        if (c.status != ClaimStatus.None) revert AlreadyListed();
        IPaymentRouter.Invoice memory inv = router.invoices(invoiceId);
        if (
            inv.status != IPaymentRouter.Status.Open || inv.paid != 0 || inv.hook != address(0)
                || inv.dueDate <= block.timestamp
        ) revert InvoiceNotSellable();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(TERMS_TYPEHASH, invoiceId, discountBps, reserveBps, deadline)));
        if (!SignatureChecker.isValidSignatureNow(inv.merchant, digest, termsSig)) revert BadSignature();
        (uint128 price, uint128 reserve) = quote(inv.amount, discountBps, reserveBps);
        if (price == 0) revert ZeroAmount();

        c.payee = inv.payout;
        c.face = inv.amount;
        c.price = price;
        c.reserve = reserve;
        c.dueDate = inv.dueDate;
        c.fundBy = uint64(deadline > inv.dueDate ? inv.dueDate : deadline);
        c.status = ClaimStatus.Listed;
        emit ClaimListed(invoiceId, inv.merchant, inv.amount, price, reserve, inv.dueDate);

        router.setHook(invoiceId, address(this), deadline, hookSig);
    }

    /// @notice Withdraws a listing that nobody has funded yet and cancels the invoice on the router. Needs the
    ///         merchant's router CancelInvoice signature (the router lets only this contract cancel a hooked invoice).
    ///         A funded claim cannot be cancelled: the investor owns it.
    function cancelListing(bytes32 invoiceId, uint256 deadline, bytes calldata cancelSig) external nonReentrant {
        Claim storage c = _claims[invoiceId];
        if (c.status != ClaimStatus.Listed) revert NotListed();
        c.status = ClaimStatus.Cancelled;
        emit ClaimCancelled(invoiceId);
        router.cancel(invoiceId, deadline, cancelSig);
    }

    // ------------------------------------------------------------------ fund

    /// @notice An allowlisted investor buys the claim. `a.payer` is the investor; the USDT authorization is bound to
    ///         this invoice, so it cannot be spent elsewhere. Mints the token to the investor.
    function fund(bytes32 invoiceId, IPaymentRouter.Auth calldata a) external whenNotPaused nonReentrant {
        Claim storage c = _claims[invoiceId];
        if (c.status != ClaimStatus.Listed) revert NotListed();
        if (block.timestamp > c.fundBy) revert Expired();
        if (!registry.isAllowed(a.payer)) revert NotAllowlisted();
        // the merchant could have cancelled the invoice on the router since listing
        if (router.invoices(invoiceId).status != IPaymentRouter.Status.Open) revert InvoiceNotSellable();

        c.status = ClaimStatus.Funded;
        uint128 advance = c.price - c.reserve;
        emit ClaimFunded(invoiceId, a.payer, c.price, advance);
        _mint(a.payer, uint256(invoiceId));

        usdt.receiveWithAuthorization(
            a.payer, address(this), c.price, a.validAfter, a.validBefore, fundNonce(invoiceId, a.salt), a.signature
        );
        if (advance != 0) IERC20(address(usdt)).safeTransfer(c.payee, advance);
    }

    // ------------------------------------------------------------------ payments (router hook)

    /// @inheritdoc IClaimPayout
    function onPaid(bytes32 invoiceId, uint128 value) external {
        if (msg.sender != address(router)) revert NotRouter();
        Claim storage c = _claims[invoiceId];
        ClaimStatus s = c.status;
        if (s == ClaimStatus.None) revert NotListed(); // never accept money for something we do not know

        c.received += value;
        if (s != ClaimStatus.Funded && s != ClaimStatus.Defaulted) {
            // not sold (Listed/Cancelled) or already closed (Settled): the money belongs to the merchant
            if (s == ClaimStatus.Listed) {
                c.status = ClaimStatus.Cancelled;
                emit ClaimCancelled(invoiceId);
            }
            emit ClaimPaid(invoiceId, address(0), 0, value);
            _send(c.payee, value);
            return;
        }

        address holder = _ownerOf(uint256(invoiceId));
        uint128 owed = c.face - c.toHolder;
        uint128 toHolder = value < owed ? value : owed;
        c.toHolder += toHolder;
        emit ClaimPaid(invoiceId, holder, toHolder, value - toHolder);
        bool settled = s == ClaimStatus.Funded && c.toHolder == c.face;
        if (settled) {
            c.status = ClaimStatus.Settled;
            emit ClaimSettled(invoiceId, c.reserve);
        }

        // interactions last
        _send(holder, toHolder);
        if (value != toHolder) _send(c.payee, value - toHolder);
        if (settled) _send(c.payee, c.reserve);
    }

    // ------------------------------------------------------------------ default

    /// @notice Anyone, once `GRACE` after the due date has passed and the claim is still not settled.
    function markDefault(bytes32 invoiceId) external whenNotPaused nonReentrant {
        Claim storage c = _claims[invoiceId];
        if (c.status != ClaimStatus.Funded) revert NotFunded();
        if (block.timestamp <= uint256(c.dueDate) + GRACE) revert GraceNotOver();

        address holder = _ownerOf(uint256(invoiceId));
        uint128 owed = c.face - c.toHolder;
        uint128 toHolder = c.reserve < owed ? c.reserve : owed;
        c.toHolder += toHolder;
        c.status = ClaimStatus.Defaulted;
        emit ClaimDefaulted(invoiceId, holder, toHolder);
        _send(holder, toHolder);
        if (c.reserve != toHolder) _send(c.payee, c.reserve - toHolder);
    }

    // ------------------------------------------------------------------ pull payments

    function withdrawPending(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = pending[msg.sender];
        if (amount == 0) revert NothingPending();
        pending[msg.sender] = 0;
        totalPending -= amount;
        emit PendingWithdrawn(msg.sender, to, amount);
        IERC20(address(usdt)).safeTransfer(to, amount);
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

    // ------------------------------------------------------------------ internal

    /// @dev Transfers rules, enforced for every ownership change that is not the mint in `fund`:
    ///      not paused, claim still Funded or Defaulted (frozen once Settled), sender and receiver both allowlisted.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0)) {
            // there is no burn function, so `to` is never zero here
            _requireNotPaused();
            ClaimStatus s = _claims[bytes32(tokenId)].status;
            if (s != ClaimStatus.Funded && s != ClaimStatus.Defaulted) revert TransferLocked();
            if (!registry.isAllowed(from) || !registry.isAllowed(to)) revert NotAllowlisted();
        }
        return super._update(to, tokenId, auth);
    }

    /// @dev Pays out without ever reverting the customer's payment: a refused transfer is credited to `pending`.
    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        // slither-disable-next-line low-level-calls -- a failing token must not block payments; falls back to `pending`
        (bool ok, bytes memory ret) = address(usdt).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) {
            pending[to] += amount;
            totalPending += amount;
            emit PayoutDeferred(to, amount);
        }
    }
}
