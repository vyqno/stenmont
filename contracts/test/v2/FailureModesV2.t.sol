// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {PaymentRouterV2} from "../../src/PaymentRouterV2.sol";
import {ReputationRegistryV2} from "../../src/ReputationRegistryV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

// ------------------------------------------------------------------ hostile downstream contracts

/// @dev Answers `record` with bytes that decode to nothing sensible.
contract GarbageReputation {
    fallback() external {
        assembly {
            mstore(0, 0xdeadbeef)
            return(0, 7)
        }
    }
}

/// @dev Returns as much data as 100k gas lets it allocate (a return-data bomb).
contract ReturnBombReputation {
    fallback() external {
        assembly {
            return(0, 190000)
        }
    }
}

/// @dev Tries to re-enter the router from inside the reputation call.
contract ReentrantReputation {
    PaymentRouterV2 internal immutable router;
    bool public reentered;

    constructor(PaymentRouterV2 r) {
        router = r;
    }

    function record(address, address, uint128, bool) external {
        IPaymentRouterV2.Auth memory a;
        router.refund(bytes32(0), 1, address(this), a); // must hit the reentrancy guard and revert
        reentered = true;
    }
}

/// @dev ERC-1271 wallet that tries to write state while validating (only possible outside a staticcall).
contract StateWritingWallet {
    uint256 public writes;

    function isValidSignature(bytes32, bytes calldata) external returns (bytes4) {
        writes++;
        return 0x1626ba7e;
    }
}

/// @dev ERC-1271 wallet that answers with one byte instead of a bytes4 word.
contract MalformedWallet {
    fallback() external {
        assembly {
            mstore(0, 0x1626ba7e00000000000000000000000000000000000000000000000000000000)
            return(0, 1)
        }
    }
}

/// @dev A hook that attaches itself to an invoice and then misbehaves in `onPaid`.
contract HostileHook {
    uint8 public mode; // 0 burn all gas, 1 re-enter refund, 2 re-enter pay

    function attach(PaymentRouterV2 r, bytes32 id, uint256 deadline, bytes calldata sig) external {
        r.setHook(id, address(this), deadline, sig);
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function onPaid(bytes32 id, uint128) external {
        IPaymentRouterV2.Auth memory a;
        if (mode == 0) {
            while (true) {}
        } else if (mode == 1) {
            PaymentRouterV2(msg.sender).refund(id, 1, address(this), a);
        } else {
            PaymentRouterV2(msg.sender).pay(id, 1, address(this), a);
        }
    }
}

/// @notice Fail-safe behaviour of router v2 and claim v2 when what they call misbehaves: reverts, gas exhaustion,
///         malformed return data and re-entry. After every call the router holds no USDT and the claim holds exactly
///         its live reserves plus pending payouts.
contract FailureModesV2Test is ClaimBaseV2 {
    bytes32 internal constant REF = keccak256("FM-1");

    function _wire(address rep) internal {
        vm.prank(owner);
        router.setReputation(rep);
    }

    function _realReputation() internal returns (ReputationRegistryV2 rep) {
        rep = new ReputationRegistryV2(owner);
        vm.prank(owner);
        rep.setRecorder(address(router), true);
        _wire(address(rep));
    }

    function _routerEmpty() internal view {
        assertEq(usdt.balanceOf(address(router)), 0, "router holds no USDT");
    }

    // ================================================================ reputation registry failures

    function test_reputation_malformedReturn_paymentSettles() public {
        _wire(address(new GarbageReputation()));
        bytes32 id = _newInvoice(REF, AMOUNT);
        _pay(id, AMOUNT, payerPk, "s");
        assertEq(uint8(_status(id)), uint8(IPaymentRouterV2.Status.Paid));
        assertEq(usdt.balanceOf(payout), AMOUNT);
        _routerEmpty();
    }

    function test_reputation_returnBomb_paymentSettles() public {
        _wire(address(new ReturnBombReputation()));
        bytes32 id = _newInvoice(REF, AMOUNT);
        _pay(id, AMOUNT, payerPk, "s");
        assertEq(uint8(_status(id)), uint8(IPaymentRouterV2.Status.Paid));
        _routerEmpty();
    }

    function test_reputation_reentry_isBlocked_paymentSettles() public {
        ReentrantReputation rep = new ReentrantReputation(router);
        _wire(address(rep));
        bytes32 id = _newInvoice(REF, AMOUNT);
        _pay(id, AMOUNT, payerPk, "s");
        assertFalse(rep.reentered(), "the guard stopped the nested refund");
        assertEq(uint8(_status(id)), uint8(IPaymentRouterV2.Status.Paid));
        _routerEmpty();
    }

    /// @dev A broken registry cannot deny an investor settlement: the sold invoice settles and the reserve is released.
    function test_reputation_revertOrGasBurn_cannotDenyClaimSettlement() public {
        _wire(address(new ReturnBombReputation()));
        bytes32 id = _funded(REF);
        uint256 inv0 = usdt.balanceOf(investor);
        _pay(id, AMOUNT, payerPk, "s");
        assertEq(uint8(claim.claims(id).status), uint8(InvoiceClaimV2.ClaimStatus.Settled));
        assertEq(usdt.balanceOf(investor), inv0 + AMOUNT);
        assertEq(usdt.balanceOf(payout), ADVANCE + RESERVE_AMT);
        assertEq(usdt.balanceOf(address(claim)), 0);
        _routerEmpty();
    }

    function test_reputation_realRegistry_recordsOncePerFullPayment() public {
        ReputationRegistryV2 rep = _realReputation();
        bytes32 id = _newInvoice(REF, AMOUNT);
        _pay(id, AMOUNT, payerPk, "s");
        assertEq(rep.paidCount(payer), 1);
        assertEq(rep.onTimeCounterparties(payer), 1);
    }

    // ================================================================ ERC-1271 signer failures

    function test_erc1271_stateWritingWallet_isRejectedNotExecuted() public {
        StateWritingWallet w = new StateWritingWallet();
        IPaymentRouterV2.CreateInvoice memory r = _req(REF, AMOUNT);
        r.merchant = address(w);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.createInvoice(r, hex"01");
        assertEq(w.writes(), 0, "validation runs in a staticcall");
    }

    function test_erc1271_malformedAnswer_isRejected() public {
        MalformedWallet w = new MalformedWallet();
        IPaymentRouterV2.CreateInvoice memory r = _req(REF, AMOUNT);
        r.merchant = address(w);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        router.createInvoice(r, hex"01");
    }

    // ================================================================ hook failures (pay reverts whole, nothing moves)

    function _hostile(uint8 mode) internal returns (bytes32 id, HostileHook h) {
        id = _newInvoice(REF, AMOUNT);
        h = new HostileHook();
        h.setMode(mode);
        h.attach(router, id, T0 + 1 days, _hookSig(merchantPk, id, address(h), T0 + 1 days));
    }

    function _assertNothingMoved(bytes32 id, address hook) internal view {
        assertEq(router.invoices(id).paid, 0);
        assertEq(usdt.balanceOf(payer), 10_000e6, "payer keeps the money");
        assertEq(usdt.balanceOf(hook), 0);
        _routerEmpty();
    }

    function test_hook_outOfGas_revertsWholePayment() public {
        (bytes32 id, HostileHook h) = _hostile(0);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, "s");
        vm.expectRevert();
        router.pay{gas: 3_000_000}(id, AMOUNT, payout, a);
        _assertNothingMoved(id, address(h));
    }

    function test_hook_reentersRefund_revertsWholePayment() public {
        (bytes32 id, HostileHook h) = _hostile(1);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, "s");
        vm.expectRevert();
        router.pay(id, AMOUNT, payout, a);
        _assertNothingMoved(id, address(h));
    }

    function test_hook_reentersPay_revertsWholePayment() public {
        (bytes32 id, HostileHook h) = _hostile(2);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, "s");
        vm.expectRevert();
        router.pay(id, AMOUNT, payout, a);
        _assertNothingMoved(id, address(h));
    }

    // ================================================================ claim payout failures

    function _claimHolds(uint256 reserves) internal view {
        assertEq(usdt.balanceOf(address(claim)), reserves + claim.totalPending(), "claim = reserves + pending");
    }

    function test_claim_holderTransferReverts_paymentStillSettles_creditedToPending() public {
        bytes32 id = _funded(REF);
        vm.mockCallRevert(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(AMOUNT))), "blocked");
        _pay(id, AMOUNT, payerPk, "s");
        vm.clearMockedCalls();
        assertEq(uint8(claim.claims(id).status), uint8(InvoiceClaimV2.ClaimStatus.Settled));
        assertEq(claim.pending(investor), AMOUNT);
        _claimHolds(0);
        _routerEmpty();

        vm.prank(investor);
        claim.withdrawPending(investor2);
        assertEq(claim.pending(investor), 0);
        _claimHolds(0);
        assertEq(usdt.balanceOf(address(claim)), 0, "drained after settlement");
    }

    function test_claim_holderTransferReturnsFalse_creditedToPending() public {
        bytes32 id = _funded(REF);
        vm.mockCall(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(40e6))), abi.encode(false));
        _pay(id, 40e6, payerPk, "s");
        vm.clearMockedCalls();
        assertEq(claim.pending(investor), 40e6);
        _claimHolds(RESERVE_AMT);
        _routerEmpty();
    }

    /// @dev A token that answers with malformed data makes the claim revert, so the whole payment unwinds.
    function test_claim_malformedTokenAnswer_revertsWholePayment() public {
        bytes32 id = _funded(REF);
        vm.mockCall(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(40e6))), hex"01");
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 40e6, "s");
        vm.expectRevert();
        router.pay(id, 40e6, payout, a);
        vm.clearMockedCalls();
        assertEq(router.invoices(id).paid, 0);
        assertEq(claim.claims(id).received, 0);
        _claimHolds(RESERVE_AMT);
        _routerEmpty();
    }

    /// @dev Whatever gas the submitter picks, a payment either reverts as a whole or reaches the holder directly; it
    ///      never succeeds with the holder's share silently parked in `pending`.
    function test_claim_gasStarvation_neverParksAPayoutSilently() public {
        bytes32 id = _funded(REF);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, "s");
        bytes memory call_ = abi.encodeCall(router.pay, (id, AMOUNT, payout, a));
        uint256 okCount;
        for (uint256 g = 60_000; g < 400_000; g += 2000) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(router).call{gas: g}(call_);
            if (ok) {
                okCount++;
                assertEq(claim.totalPending(), 0, "no silent deferral");
                assertEq(uint8(claim.claims(id).status), uint8(InvoiceClaimV2.ClaimStatus.Settled));
            } else {
                assertEq(router.invoices(id).paid, 0);
            }
            _routerEmpty();
            vm.revertToState(snap);
        }
        assertGt(okCount, 0, "the sweep reached the success region");
    }

    function test_claim_noDoubleSettlement() public {
        bytes32 id = _funded(REF);
        _pay(id, AMOUNT, payerPk, "s");
        vm.warp(T0 + 60 days);
        vm.expectRevert(InvoiceClaimV2.NotFunded.selector);
        claim.markDefault(id);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 1, "again");
        vm.expectRevert(IPaymentRouterV2.InvoiceNotOpen.selector);
        router.pay(id, 1, payout, a);
        vm.expectRevert(InvoiceClaimV2.NotRouter.selector);
        claim.onPaid(id, 1);
        assertEq(usdt.balanceOf(address(claim)), 0);
    }

    function test_claim_defaultTwice_reverts() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 60 days);
        claim.markDefault(id);
        vm.expectRevert(InvoiceClaimV2.NotFunded.selector);
        claim.markDefault(id);
        _claimHolds(0);
    }

    /// @dev Defence in depth: the router reports the invoice is no longer open (unreachable with the real router,
    ///      because only the claim can cancel a hooked invoice and any payment cancels a listing).
    function test_claim_fund_routerSaysNotOpen_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouterV2.Invoice memory inv = router.invoices(id);
        inv.status = IPaymentRouterV2.Status.Cancelled;
        vm.mockCall(address(router), abi.encodeCall(router.invoices, (id)), abi.encode(inv));
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, "f");
        vm.expectRevert(InvoiceClaimV2.InvoiceNotSellable.selector);
        claim.fund(id, a);
    }

    // ================================================================ pause and guardian paths

    function test_routerPause_blocksEveryWrite_guardianCannotUnpause() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        _pay(id, 40e6, payerPk, "s");
        vm.prank(guardian);
        router.pause();

        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 10e6, "t");
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.pay(id, 10e6, payout, a);
        IPaymentRouterV2.Auth memory r = _refundAuth(merchantPk, id, payer, 10e6, "r");
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.refund(id, 10e6, payer, r);
        IPaymentRouterV2.CreateInvoice memory c = _req(keccak256("FM-2"), AMOUNT);
        bytes memory cs = _sig(merchantPk, _createHash(c));
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.createInvoice(c, cs);
        bytes memory xs = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.cancel(id, T0 + 1 days, xs);

        vm.prank(guardian);
        vm.expectRevert();
        router.unpause();
        vm.prank(owner);
        router.unpause();
        _pay(id, 60e6, payerPk, "u");
        assertEq(uint8(_status(id)), uint8(IPaymentRouterV2.Status.Paid));
        _routerEmpty();
    }

    /// @dev A paused claim never blocks the customer: payments still settle and pending payouts can be pulled.
    function test_claimPause_paymentsSettle_withdrawWorks_defaultAndFundBlocked() public {
        bytes32 id = _funded(REF);
        bytes32 id2 = _listed(keccak256("FM-2"));
        vm.prank(guardian);
        claim.pause();

        IPaymentRouterV2.Auth memory f = _fundAuth(investorPk, id2, PRICE, "f2");
        vm.expectRevert(Pausable.EnforcedPause.selector);
        claim.fund(id2, f);

        vm.mockCallRevert(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(AMOUNT))), "blocked");
        _pay(id, AMOUNT, payerPk, "s");
        vm.clearMockedCalls();
        assertEq(uint8(claim.claims(id).status), uint8(InvoiceClaimV2.ClaimStatus.Settled));
        vm.prank(investor);
        claim.withdrawPending(investor);
        assertEq(claim.totalPending(), 0);

        vm.warp(T0 + 60 days);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        claim.markDefault(id2);
        _claimHolds(0);
        _routerEmpty();
    }

    // ================================================================ early-payment discount races

    /// @dev Integration rule: a discounted payment must be signed with validBefore = discountUntil + 1, so a
    ///      submission delayed past the window is refused by the token instead of landing as a partial payment.
    function test_discount_lateSubmission_withBoundedAuth_isRefusedNotConverted() public {
        uint64 until = uint64(T0 + 10 days);
        bytes32 id = _create(_discountReq(REF, AMOUNT, 200, until));
        uint128 v = router.settlementAmount(id); // 98
        bytes32 nonce = router.payNonce(id, payout, "s");
        IPaymentRouterV2.Auth memory a = IPaymentRouterV2.Auth({
            payer: payer,
            validAfter: 0,
            validBefore: uint256(until) + 1,
            salt: "s",
            signature: _sig(payerPk, _usdtDigestTo(payer, address(router), v, uint256(until) + 1, nonce))
        });
        vm.warp(uint256(until) + 1);
        vm.expectRevert(bytes("authorization is expired"));
        router.pay(id, v, payout, a);
        assertEq(router.invoices(id).paid, 0);
    }

    /// @dev Without that bound the same signed amount lands as a partial payment and the discount is forfeited.
    function test_discount_lateSubmission_withLooseAuth_becomesPartial() public {
        uint64 until = uint64(T0 + 10 days);
        bytes32 id = _create(_discountReq(REF, AMOUNT, 200, until));
        uint128 v = router.settlementAmount(id);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, v, "s");
        vm.warp(uint256(until) + 1);
        router.pay(id, v, payout, a);
        assertEq(uint8(_status(id)), uint8(IPaymentRouterV2.Status.Open));
        assertEq(router.remaining(id), AMOUNT - v);
    }

    /// @dev On an unlocked invoice anyone can make the first payment, so a dust payment forfeits the discount. The
    ///      buyer's discounted authorization then lands as a partial payment (see docs/ROUTER-V2-SECURITY.md, M-2).
    function test_discount_unlockedInvoice_dustFrontRunForfeitsDiscount() public {
        bytes32 id = _create(_discountReq(REF, AMOUNT, 200, uint64(T0 + 10 days)));
        IPaymentRouterV2.Auth memory buyer = _payAuth(payerPk, id, 98e6, "buyer");
        _pay(id, 1, payer2Pk, "dust");
        router.pay(id, 98e6, payout, buyer);
        assertEq(uint8(_status(id)), uint8(IPaymentRouterV2.Status.Open));
        assertEq(router.invoices(id).discount, 0);
        assertEq(router.remaining(id), 2e6 - 1);
    }

    /// @dev Mitigation available today: with payerLock set, only the buyer can pay, so nobody can pre-empt the offer.
    function test_discount_lockedInvoice_dustFrontRunRefused_buyerSettlesAtDiscount() public {
        IPaymentRouterV2.CreateInvoice memory r = _discountReq(REF, AMOUNT, 200, uint64(T0 + 10 days));
        r.payerLock = payer;
        bytes32 id = _create(r);
        IPaymentRouterV2.Auth memory dust = _payAuth(payer2Pk, id, 1, "dust");
        vm.expectRevert(IPaymentRouterV2.WrongPayer.selector);
        router.pay(id, 1, payout, dust);
        _pay(id, 98e6, payerPk, "buyer");
        assertEq(uint8(_status(id)), uint8(IPaymentRouterV2.Status.Paid));
        assertEq(router.invoices(id).discount, 2e6);
        _routerEmpty();
    }
}
