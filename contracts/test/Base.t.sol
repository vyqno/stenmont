// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {Test} from "forge-std/Test.sol";

/// @dev Shared setup and signing helpers for PaymentRouter tests.
abstract contract Base is Test {
    PaymentRouter internal router;
    MockUSDT internal usdt;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal treasury = makeAddr("treasury");
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

    function setUp() public virtual {
        vm.warp(T0);
        attester = vm.addr(attesterPk);
        merchant = vm.addr(merchantPk);
        payer = vm.addr(payerPk);
        payer2 = vm.addr(payer2Pk);
        usdt = new MockUSDT();
        router = new PaymentRouter(address(usdt), owner, guardian, attester, THRESHOLD);
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

    function _req(bytes32 ref, uint128 amount) internal view returns (IPaymentRouter.CreateInvoice memory r) {
        r = IPaymentRouter.CreateInvoice({
            merchant: merchant,
            ref: ref,
            payout: payout,
            payerLock: address(0),
            amount: amount,
            minPayment: 0,
            dueDate: uint64(T0 + 30 days),
            metaHash: keccak256("meta"),
            deadline: T0 + 1 days
        });
    }

    function _createHash(IPaymentRouter.CreateInvoice memory r) internal view returns (bytes32) {
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
                    r.metaHash,
                    r.deadline
                )
            )
        );
    }

    function _create(IPaymentRouter.CreateInvoice memory r) internal returns (bytes32 id) {
        vm.prank(relayer);
        router.createInvoice(r, _sig(merchantPk, _createHash(r)));
        id = router.invoiceIdOf(r.merchant, r.ref);
    }

    function _newInvoice(bytes32 ref, uint128 amount) internal returns (bytes32) {
        return _create(_req(ref, amount));
    }

    /// @dev EIP-3009 digest for the token, for any `from`.
    function _usdtDigest(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(router), value, validAfter, validBefore, nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash));
    }

    function _payAuth(uint256 pk, bytes32 id, uint128 value, bytes32 salt)
        internal
        view
        returns (IPaymentRouter.Auth memory a)
    {
        address from = vm.addr(pk);
        bytes32 nonce = router.payNonce(id, salt);
        a = IPaymentRouter.Auth({
            payer: from,
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: salt,
            signature: _sig(pk, _usdtDigest(from, value, 0, T0 + 1 days, nonce))
        });
    }

    function _refundAuth(uint256 pk, bytes32 id, address to, uint128 value, bytes32 salt)
        internal
        view
        returns (IPaymentRouter.Auth memory a)
    {
        address from = vm.addr(pk);
        bytes32 nonce = router.refundNonce(id, to, salt);
        a = IPaymentRouter.Auth({
            payer: from,
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: salt,
            signature: _sig(pk, _usdtDigest(from, value, 0, T0 + 1 days, nonce))
        });
    }

    function _pay(bytes32 id, uint128 value, uint256 pk, bytes32 salt) internal {
        IPaymentRouter.Auth memory a = _payAuth(pk, id, value, salt);
        vm.prank(relayer);
        router.pay(id, value, a);
    }

    function _refund(bytes32 id, uint128 value, address to, bytes32 salt) internal {
        IPaymentRouter.Auth memory a = _refundAuth(merchantPk, id, to, value, salt);
        vm.prank(relayer);
        router.refund(id, value, to, a);
    }

    function _approval(bytes32 id, uint128 value, address to, bytes32 salt, uint256 deadline, uint256 pk)
        internal
        view
        returns (IPaymentRouter.Approval memory)
    {
        bytes32 opHash = keccak256(abi.encode(id, value, to, salt));
        bytes32 digest = _routerDigest(keccak256(abi.encode(router.REFUND_APPROVAL_TYPEHASH(), opHash, deadline)));
        return IPaymentRouter.Approval({deadline: deadline, signature: _sig(pk, digest)});
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
}
