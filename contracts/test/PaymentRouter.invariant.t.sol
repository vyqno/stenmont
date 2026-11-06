// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PaymentRouter} from "../src/PaymentRouter.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {Test, console2} from "forge-std/Test.sol";

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
    uint256 public calls_approvedRefund;
    uint256 public calls_creator;
    uint256 public calls_attack;
    uint256 public attackSuccesses;
    uint256 internal attesterPk;
    uint256 internal constant THRESHOLD = 50_000;

    uint256 public constant START_BALANCE = 1e15;

    constructor(PaymentRouter router_, MockUSDT usdt_, uint256 attesterPk_) {
        router = router_;
        attesterPk = attesterPk_;
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
        // start at a random invoice and take the first one with something refundable, so refunds actually happen
        bytes32 id;
        uint256 p;
        uint128 refundable;
        for (uint256 k; k < ids.length && refundable == 0; k++) {
            id = ids[((idSeed % ids.length) + k) % ids.length];
            p = payerSeed % 4;
            refundable = router.paidBy(id, payers[p]) - router.refundedTo(id, payers[p]);
        }
        if (refundable == 0) return;
        value = uint128(bound(value, 1, refundable));
        uint256 m = merchantOf[id];

        bytes32 salt = keccak256(abi.encode("rsalt", ++counter));
        bytes32 nonce = router.refundNonce(id, payers[p], salt);
        uint256 validBefore = block.timestamp + 1 days;
        bytes32 digest = _tokenDigest(merchants[m], value, validBefore, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPks[m], digest);
        IPaymentRouter.Auth memory auth = IPaymentRouter.Auth({
            payer: merchants[m],
            validAfter: 0,
            validBefore: validBefore,
            salt: salt,
            signature: abi.encodePacked(r, s, v)
        });
        if (uint256(router.invoices(id).refunded) + value > THRESHOLD) {
            // a human approval signed by the attester, bound to exactly this operation
            uint256 apDeadline = block.timestamp + 1 days;
            bytes32 opHash = keccak256(abi.encode(id, value, payers[p], salt));
            bytes32 apDigest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    router.domainSeparator(),
                    keccak256(abi.encode(router.REFUND_APPROVAL_TYPEHASH(), opHash, apDeadline))
                )
            );
            (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(attesterPk, apDigest);
            router.refundWithApproval(
                id,
                value,
                payers[p],
                auth,
                IPaymentRouter.Approval({deadline: apDeadline, signature: abi.encodePacked(ar, as_, av)})
            );
            calls_approvedRefund++;
        } else {
            router.refund(id, value, payers[p], auth);
        }
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
                "\x19\x01", router.domainSeparator(), keccak256(abi.encode(router.CANCEL_TYPEHASH(), id, deadline))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPks[merchantOf[id]], digest);
        router.cancel(id, deadline, abi.encodePacked(r, s, v));
        calls_cancel++;
    }

    /// the merchant delegates to this handler once, then the handler creates an invoice as the delegate
    function createAsCreator(uint256 mSeed, uint128 amount) external {
        uint256 m = mSeed % 3;
        amount = uint128(bound(amount, 1, 1e9));
        if (!router.creators(merchants[m], address(this))) {
            uint256 deadline = block.timestamp + 1 days;
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    router.domainSeparator(),
                    keccak256(
                        abi.encode(
                            router.SET_CREATOR_TYPEHASH(),
                            merchants[m],
                            address(this),
                            true,
                            deadline,
                            router.creatorNonce(merchants[m])
                        )
                    )
                )
            );
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(merchantPks[m], digest);
            router.setCreator(merchants[m], address(this), true, deadline, abi.encodePacked(r, s, v));
        }
        IPaymentRouter.CreateInvoice memory req = IPaymentRouter.CreateInvoice({
            merchant: merchants[m],
            ref: keccak256(abi.encode(++counter)),
            payout: sinks[m],
            payerLock: address(0),
            amount: amount,
            minPayment: 0,
            dueDate: 0,
            metaHash: bytes32(counter),
            deadline: block.timestamp + 1 days
        });
        router.createInvoiceAsCreator(req);
        bytes32 id = router.invoiceIdOf(req.merchant, req.ref);
        ids.push(id);
        merchantOf[id] = m;
        calls_creator++;
    }

    /// An attacker (no role, no merchant key) tries every forbidden entry point. Each must revert; any success is
    /// recorded and fails `invariant_attackerNeverSucceeds`.
    function attack(uint256 idSeed, uint256 kind, uint128 value) external {
        calls_attack++;
        address attacker = address(0xBAD);
        uint256 attackerPk = 0xBAD1;
        vm.startPrank(attacker);
        bytes32 id = ids.length == 0 ? bytes32(0) : ids[idSeed % ids.length];
        IPaymentRouter.Invoice memory inv = router.invoices(id);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory junk = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)), uint8(27));
        kind = kind % 8;
        bool ok;
        if (kind == 0) {
            // cancel with the attacker's own signature
            bytes32 d = keccak256(
                abi.encodePacked(
                    "\x19\x01", router.domainSeparator(), keccak256(abi.encode(router.CANCEL_TYPEHASH(), id, deadline))
                )
            );
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, d);
            try router.cancel(id, deadline, abi.encodePacked(r, s, v)) {
                ok = true;
            } catch {}
        } else if (kind == 1) {
            // refund funded by the attacker instead of the merchant (also: to a non-payer)
            IPaymentRouter.Auth memory a = IPaymentRouter.Auth(attacker, 0, deadline, bytes32(uint256(7)), junk);
            try router.refund(id, value, attacker, a) {
                ok = true;
            } catch {}
        } else if (kind == 2) {
            // refund with a forged approval
            IPaymentRouter.Auth memory a = IPaymentRouter.Auth(inv.merchant, 0, deadline, bytes32(uint256(8)), junk);
            try router.refundWithApproval(id, value, attacker, a, IPaymentRouter.Approval(deadline, junk)) {
                ok = true;
            } catch {}
        } else if (kind == 3) {
            // create an invoice in a merchant's name without a signature or delegation
            IPaymentRouter.CreateInvoice memory req = IPaymentRouter.CreateInvoice(
                merchants[0], bytes32(uint256(0xAA)), attacker, address(0), 1, 0, 0, bytes32(0), deadline
            );
            try router.createInvoice(req, junk) {
                ok = true;
            } catch {}
            try router.createInvoiceAsCreator(req) {
                ok = true;
            } catch {}
        } else if (kind == 4) {
            try router.setReputation(attacker) {
                ok = true;
            } catch {}
            try router.setAttester(attacker) {
                ok = true;
            } catch {}
            try router.setRefundApprovalThreshold(type(uint128).max) {
                ok = true;
            } catch {}
        } else if (kind == 5) {
            // hook an invoice to the attacker's own contract without the merchant's signature
            try router.setHook(id, address(this), deadline, junk) {
                ok = true;
            } catch {}
        } else if (kind == 6) {
            // delegate themselves as creator of a merchant
            try router.setCreator(merchants[0], attacker, true, deadline, junk) {
                ok = true;
            } catch {}
        } else {
            // pay with someone else's money: a payer authorization they never signed
            IPaymentRouter.Auth memory a = IPaymentRouter.Auth(payers[0], 0, deadline, bytes32(uint256(9)), junk);
            try router.pay(id, value == 0 ? 1 : value, a) {
                ok = true;
            } catch {}
        }
        vm.stopPrank();
        if (ok) attackSuccesses++;
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
    uint256 internal constant ATTESTER_PK = 0xA77E57;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdt = new MockUSDT();
        // a low threshold so refunds past it exercise the attester-approval path; the handler holds the attester key
        router = new PaymentRouter(address(usdt), address(this), address(this), vm.addr(ATTESTER_PK), 50_000);
        handler = new RouterHandler(router, usdt, ATTESTER_PK);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = RouterHandler.createInvoice.selector;
        selectors[1] = RouterHandler.pay.selector;
        selectors[2] = RouterHandler.refund.selector;
        selectors[3] = RouterHandler.cancel.selector;
        selectors[4] = RouterHandler.warp.selector;
        selectors[5] = RouterHandler.createAsCreator.selector;
        selectors[6] = RouterHandler.attack.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// custody: the router never keeps a cent
    function invariant_routerHoldsNoUSDT() public view {
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    /// no role-less caller ever changes anything
    function invariant_attackerNeverSucceeds() public view {
        assertEq(handler.attackSuccesses(), 0);
        assertEq(router.attester(), vm.addr(ATTESTER_PK));
        assertEq(router.reputation(), address(0));
        assertEq(router.refundApprovalThreshold(), 50_000);
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
        console2.log("approved refunds", handler.calls_approvedRefund());
        console2.log("creator-path invoices", handler.calls_creator());
        console2.log("attack calls", handler.calls_attack());
        console2.log("total paid (units)", handler.ghostPaid());
        console2.log("total refunded (units)", handler.ghostRefunded());
    }
}
