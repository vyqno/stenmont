// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {Test, console2} from "forge-std/Test.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

/// @dev Drives the router through random sequences with funded actors. Every action is bounded to be valid,
///      so a run that reverts is a bug in the handler or the contract (fail_on_revert = true).
contract RouterHandler is Test {
    PaymentRouter public router;
    MockUSDT public usdt;

    uint256[3] internal merchantPks = [uint256(0xA001), 0xA002, 0xA003];
    uint256[4] internal payerPks = [uint256(0xB001), 0xB002, 0xB003, 0xB004];
    address[3] public merchants;
    address[4] public payers;
    address[3] public sinks; // each merchant's payout address

    bytes32[] public ids;
    mapping(bytes32 id => uint256 merchantIdx) internal merchantOf;

    uint256 public ghostPaid;
    uint256 public ghostRefunded;
    uint256 internal counter;
    uint256 public calls_create;
    uint256 public calls_pay;
    uint256 public calls_refund;
    uint256 public calls_cancel;

    uint256 public constant START_BALANCE = 1e15;

    constructor(PaymentRouter router_, MockUSDT usdt_) {
        router = router_;
        usdt = usdt_;
        for (uint256 i; i < 3; i++) {
            merchants[i] = vm.addr(merchantPks[i]);
            sinks[i] = address(uint160(0x51000 + i));
            usdt.mint(merchants[i], START_BALANCE);
        }
        for (uint256 i; i < 4; i++) {
            payers[i] = vm.addr(payerPks[i]);
            usdt.mint(payers[i], START_BALANCE);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function createInvoice(uint256 mSeed, uint128 amount, uint128 minPay, uint256 lockSeed, uint64 dueOffset) external {
        uint256 m = mSeed % 3;
        amount = uint128(bound(amount, 1, 1e9));
        minPay = uint128(bound(minPay, 0, amount));
        IPaymentRouter.CreateInvoice memory r = IPaymentRouter.CreateInvoice({
            merchant: merchants[m],
            ref: keccak256(abi.encode(++counter)),
            payout: sinks[m],
            payerLock: lockSeed % 5 == 0 ? payers[lockSeed % 4] : address(0),
            amount: amount,
            minPayment: minPay,
            dueDate: uint64(block.timestamp + bound(dueOffset, 1 hours, 90 days)),
            metaHash: bytes32(counter),
            deadline: block.timestamp + 1 days
        });
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                router.domainSeparator(),
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
            )
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(merchantPks[m], digest);
        router.createInvoice(r, abi.encodePacked(rr, s, v));
        bytes32 id = router.invoiceIdOf(r.merchant, r.ref);
        ids.push(id);
        merchantOf[id] = m;
        calls_create++;
    }

    function pay(uint256 idSeed, uint256 payerSeed, uint128 value) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        IPaymentRouter.Invoice memory inv = router.invoices(id);
        if (inv.status != IPaymentRouter.Status.Open) return;
        uint256 p = inv.payerLock != address(0) ? _payerIndex(inv.payerLock) : payerSeed % 4;
        uint128 left = inv.amount - inv.paid;
        value = uint128(bound(value, 1, left));
        if (value < inv.minPayment && value != left) value = inv.minPayment <= left ? inv.minPayment : left;

        bytes32 salt = keccak256(abi.encode("salt", ++counter));
        bytes32 nonce = router.payNonce(id, salt);
        uint256 validBefore = block.timestamp + 1 days;
        bytes32 digest = _tokenDigest(payers[p], value, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(payerPks[p], digest);
        router.pay(
            id,
            value,
            IPaymentRouter.Auth({
                payer: payers[p],
                validAfter: 0,
                validBefore: validBefore,
                salt: salt,
                signature: abi.encodePacked(r, s, v)
            })
        );
        ghostPaid += value;
        calls_pay++;
    }

    function refund(uint256 idSeed, uint256 payerSeed, uint128 value) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        uint256 p = payerSeed % 4;
        uint128 refundable = router.paidBy(id, payers[p]) - router.refundedTo(id, payers[p]);
        if (refundable == 0) return;
        value = uint128(bound(value, 1, refundable));
        uint256 m = merchantOf[id];

        bytes32 salt = keccak256(abi.encode("rsalt", ++counter));
        bytes32 nonce = router.refundNonce(id, payers[p], salt);
        uint256 validBefore = block.timestamp + 1 days;
        bytes32 digest = _tokenDigest(merchants[m], value, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPks[m], digest);
        router.refund(
            id,
            value,
            payers[p],
            IPaymentRouter.Auth({
                payer: merchants[m],
                validAfter: 0,
                validBefore: validBefore,
                salt: salt,
                signature: abi.encodePacked(r, s, v)
            })
        );
        ghostRefunded += value;
        calls_refund++;
    }

    function cancel(uint256 idSeed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        if (router.invoices(id).status != IPaymentRouter.Status.Open) return;
        uint256 deadline = block.timestamp + 1 days;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                router.domainSeparator(),
                keccak256(abi.encode(router.CANCEL_TYPEHASH(), id, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPks[merchantOf[id]], digest);
        router.cancel(id, deadline, abi.encodePacked(r, s, v));
        calls_cancel++;
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 1, 20 days));
    }

    function _payerIndex(address a) internal view returns (uint256) {
        for (uint256 i; i < 4; i++) {
            if (payers[i] == a) return i;
        }
        revert("unknown payer");
    }

    function _tokenDigest(address from, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdt.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                        from,
                        address(router),
                        value,
                        uint256(0),
                        validBefore,
                        nonce
                    )
                )
            )
        );
    }
}

contract PaymentRouterInvariantTest is Test {
    PaymentRouter internal router;
    MockUSDT internal usdt;
    RouterHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdt = new MockUSDT();
        // threshold at the max: this suite checks accounting; approvals are covered by unit and fuzz tests
        router = new PaymentRouter(address(usdt), address(this), address(this), address(this), type(uint128).max);
        handler = new RouterHandler(router, usdt);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = RouterHandler.createInvoice.selector;
        selectors[1] = RouterHandler.pay.selector;
        selectors[2] = RouterHandler.refund.selector;
        selectors[3] = RouterHandler.cancel.selector;
        selectors[4] = RouterHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// custody: the router never keeps a cent
    function invariant_routerHoldsNoUSDT() public view {
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    /// conservation, both directions: what was paid sits at payouts, what left payers/merchants matches exactly
    function invariant_balancesMatchAccounting() public view {
        uint256 sinks_;
        uint256 payers_;
        uint256 merchants_;
        for (uint256 i; i < 3; i++) {
            sinks_ += usdt.balanceOf(handler.sinks(i));
            merchants_ += usdt.balanceOf(handler.merchants(i));
        }
        for (uint256 i; i < 4; i++) {
            payers_ += usdt.balanceOf(handler.payers(i));
        }
        assertEq(sinks_, handler.ghostPaid(), "payout balances != total paid");
        assertEq(payers_, 4 * handler.START_BALANCE() - handler.ghostPaid() + handler.ghostRefunded(), "payer balances");
        assertEq(merchants_, 3 * handler.START_BALANCE() - handler.ghostRefunded(), "merchant balances");
    }

    /// per-invoice accounting: bounds in both directions and the sums by payer
    function invariant_perInvoiceAccounting() public view {
        uint256 n = handler.idsLength();
        uint256 sumPaid;
        uint256 sumRefunded;
        for (uint256 i; i < n; i++) {
            bytes32 id = handler.ids(i);
            IPaymentRouter.Invoice memory inv = router.invoices(id);
            assertLe(inv.paid, inv.amount, "paid > amount");
            assertLe(inv.refunded, inv.paid, "refunded > paid");
            uint256 byPayers;
            uint256 refundedByPayers;
            for (uint256 p; p < 4; p++) {
                address payer = handler.payers(p);
                byPayers += router.paidBy(id, payer);
                refundedByPayers += router.refundedTo(id, payer);
                assertLe(router.refundedTo(id, payer), router.paidBy(id, payer), "payer refunded > paid");
            }
            assertEq(byPayers, inv.paid, "sum paidBy != paid");
            assertEq(refundedByPayers, inv.refunded, "sum refundedTo != refunded");
            if (inv.status == IPaymentRouter.Status.Paid) assertEq(inv.paid, inv.amount, "Paid but not full");
            if (inv.status == IPaymentRouter.Status.Open) assertLt(inv.paid, inv.amount, "Open but already full");
            assertTrue(inv.status != IPaymentRouter.Status.None, "created invoice has no status");
            sumPaid += inv.paid;
            sumRefunded += inv.refunded;
        }
        assertEq(sumPaid, handler.ghostPaid(), "sum paid != ghost");
        assertEq(sumRefunded, handler.ghostRefunded(), "sum refunded != ghost");
    }

    /// Prints what the run actually did, so an all-no-op run cannot pass unnoticed (read with -vv).
    function afterInvariant() public view {
        console2.log("created", handler.calls_create());
        console2.log("paid calls", handler.calls_pay());
        console2.log("refund calls", handler.calls_refund());
        console2.log("cancel calls", handler.calls_cancel());
        console2.log("total paid (units)", handler.ghostPaid());
        console2.log("total refunded (units)", handler.ghostRefunded());
    }
}
