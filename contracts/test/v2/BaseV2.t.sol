// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouterV2} from "../../src/PaymentRouterV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {MockUSDT} from "../mocks/MockUSDT.sol";
import {Test} from "forge-std/Test.sol";

/// @dev Shared setup and signing helpers for the v2 contract tests.
abstract contract BaseV2 is Test {
    PaymentRouterV2 internal router;
    MockUSDT internal usdt;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal payout = makeAddr("payout");
    address internal relayer = makeAddr("relayer");
    uint256 internal attesterPk = 0xA77E57;
    address internal attester;
    uint256 internal merchantPk = 0xBEEF01;
    address internal merchant;
    uint256 internal payerPk = 0xCAFE01;
    address internal payer;
    uint256 internal payer2Pk = 0xCAFE02;
    address internal payer2;

    uint128 internal constant THRESHOLD = 1000e6;
    uint256 internal constant T0 = 1_700_000_000;
    uint128 internal constant AMOUNT = 100e6;
    uint64 internal constant DUE = uint64(T0 + 30 days);

    function setUp() public virtual {
        vm.warp(T0);
        attester = vm.addr(attesterPk);
        merchant = vm.addr(merchantPk);
        payer = vm.addr(payerPk);
        payer2 = vm.addr(payer2Pk);
        usdt = new MockUSDT();
        router = new PaymentRouterV2(address(usdt), owner, guardian, attester, THRESHOLD);
        usdt.mint(payer, 10_000e6);
        usdt.mint(payer2, 10_000e6);
        usdt.mint(merchant, 10_000e6);
    }

    // ---------------------------------------------------------------- signing

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _routerDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", router.domainSeparator(), structHash));
    }

    function _req(bytes32 ref, uint128 amount) internal view returns (IPaymentRouterV2.CreateInvoice memory r) {
        r = IPaymentRouterV2.CreateInvoice({
            merchant: merchant,
            ref: ref,
            payout: payout,
            payerLock: address(0),
            amount: amount,
            minPayment: 0,
            dueDate: DUE,
            discountBps: 0,
            discountUntil: 0,
            metaHash: keccak256("meta"),
            deadline: T0 + 1 days
        });
    }

    function _discountReq(bytes32 ref, uint128 amount, uint16 bps, uint64 until)
        internal
        view
        returns (IPaymentRouterV2.CreateInvoice memory r)
    {
        r = _req(ref, amount);
        r.discountBps = bps;
        r.discountUntil = until;
    }

    function _createHash(IPaymentRouterV2.CreateInvoice memory r) internal view returns (bytes32) {
        return _routerDigest(
            keccak256(
                abi.encode(
                    router.CREATE_INVOICE_TYPEHASH(),
                    r.merchant,
                    r.ref,
                    r.payout,
                    r.payerLock,
                    r.amount,
                    r.minPayment,
                    r.dueDate,
                    r.discountBps,
                    r.discountUntil,
                    r.metaHash,
                    r.deadline
                )
            )
        );
    }

    function _createWith(uint256 pk, IPaymentRouterV2.CreateInvoice memory r) internal returns (bytes32 id) {
        vm.prank(relayer);
        router.createInvoice(r, _sig(pk, _createHash(r)));
        id = router.invoiceIdOf(r.merchant, r.ref);
    }

    function _create(IPaymentRouterV2.CreateInvoice memory r) internal returns (bytes32) {
        return _createWith(merchantPk, r);
    }

    function _newInvoice(bytes32 ref, uint128 amount) internal returns (bytes32) {
        return _create(_req(ref, amount));
    }

    /// @dev EIP-3009 digest for the token, for any `from`, paid to `to`.
    function _usdtDigestTo(address from, address to, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, uint256(0), validBefore, nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash));
    }

    /// @dev A payer's authorization committed to `boundPayout` (what the payer's own client resolved).
    function _payAuthFor(uint256 pk, bytes32 id, uint128 value, address boundPayout, bytes32 salt)
        internal
        view
        returns (IPaymentRouterV2.Auth memory a)
    {
        address from = vm.addr(pk);
        bytes32 nonce = router.payNonce(id, boundPayout, salt);
        a = IPaymentRouterV2.Auth({
            payer: from,
            validAfter: 0,
            validBefore: T0 + 400 days,
            salt: salt,
            signature: _sig(pk, _usdtDigestTo(from, address(router), value, T0 + 400 days, nonce))
        });
    }

    function _payAuth(uint256 pk, bytes32 id, uint128 value, bytes32 salt)
        internal
        view
        returns (IPaymentRouterV2.Auth memory)
    {
        return _payAuthFor(pk, id, value, router.invoices(id).payout, salt);
    }

    function _pay(bytes32 id, uint128 value, uint256 pk, bytes32 salt) internal {
        IPaymentRouterV2.Auth memory a = _payAuth(pk, id, value, salt);
        address p = router.invoices(id).payout;
        vm.prank(relayer);
        router.pay(id, value, p, a);
    }

    function _refundAuth(uint256 pk, bytes32 id, address to, uint128 value, bytes32 salt)
        internal
        view
        returns (IPaymentRouterV2.Auth memory a)
    {
        address from = vm.addr(pk);
        bytes32 nonce = router.refundNonce(id, to, salt);
        a = IPaymentRouterV2.Auth({
            payer: from,
            validAfter: 0,
            validBefore: T0 + 400 days,
            salt: salt,
            signature: _sig(pk, _usdtDigestTo(from, address(router), value, T0 + 400 days, nonce))
        });
    }

    function _refund(bytes32 id, uint128 value, address to, bytes32 salt) internal {
        IPaymentRouterV2.Auth memory a = _refundAuth(merchantPk, id, to, value, salt);
        vm.prank(relayer);
        router.refund(id, value, to, a);
    }

    function _approval(bytes32 id, uint128 value, address to, bytes32 salt, uint256 deadline, uint256 pk)
        internal
        view
        returns (IPaymentRouterV2.Approval memory)
    {
        bytes32 opHash = keccak256(abi.encode(id, value, to, salt));
        bytes32 digest = _routerDigest(keccak256(abi.encode(router.REFUND_APPROVAL_TYPEHASH(), opHash, deadline)));
        return IPaymentRouterV2.Approval({deadline: deadline, signature: _sig(pk, digest)});
    }

    function _cancelSig(uint256 pk, bytes32 id, uint256 deadline) internal view returns (bytes memory) {
        return _sig(pk, _routerDigest(keccak256(abi.encode(router.CANCEL_TYPEHASH(), id, deadline))));
    }

    function _hookSig(uint256 pk, bytes32 id, address hook, uint256 deadline) internal view returns (bytes memory) {
        return _sig(pk, _routerDigest(keccak256(abi.encode(router.SET_HOOK_TYPEHASH(), id, hook, deadline))));
    }

    function _creatorSig(uint256 pk, address m, address creator, bool allowed, uint256 deadline, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        return _sig(
            pk,
            _routerDigest(keccak256(abi.encode(router.SET_CREATOR_TYPEHASH(), m, creator, allowed, deadline, nonce)))
        );
    }

    function _status(bytes32 id) internal view returns (IPaymentRouterV2.Status) {
        return router.invoices(id).status;
    }
}
