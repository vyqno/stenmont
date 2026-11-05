// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {SubscriptionManager} from "../src/SubscriptionManager.sol";
import {ISubscriptionManager} from "../src/interfaces/ISubscriptionManager.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {MockWallet} from "./mocks/MockWallet.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Test} from "forge-std/Test.sol";

abstract contract SubBase is Test {
    SubscriptionManager internal mgr;
    MockUSDT internal usdt;

    address internal owner = makeAddr("owner");
    address internal guardian = makeAddr("guardian");
    address internal merchant = makeAddr("merchant");
    address internal payout = makeAddr("payout");
    address internal relayer = makeAddr("relayer");
    uint256 internal payerPk = 0xCAFE01;
    address internal payer;

    uint256 internal constant T0 = 1_700_000_000;
    uint128 internal constant AMOUNT = 10e6;
    uint32 internal constant PERIOD = 30 days;
    uint32 internal constant MAX = 12;
    bytes32 internal constant ID = keccak256("sub-1");

    function setUp() public virtual {
        vm.warp(T0);
        payer = vm.addr(payerPk);
        usdt = new MockUSDT();
        mgr = new SubscriptionManager(address(usdt), owner, guardian);
        usdt.mint(payer, 1000e6);
    }

    function _sub() internal view returns (ISubscriptionManager.Sub memory) {
        return ISubscriptionManager.Sub({
            payer: payer,
            merchant: merchant,
            payout: payout,
            amount: AMOUNT,
            periodSeconds: PERIOD,
            startAt: uint64(T0),
            maxCharges: MAX
        });
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mgrDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", mgr.domainSeparator(), structHash));
    }

    function _subscribeSig(uint256 pk, bytes32 id, ISubscriptionManager.Sub memory s, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sig(
            pk,
            _mgrDigest(
                keccak256(
                    abi.encode(
                        mgr.SUBSCRIBE_TYPEHASH(),
                        id,
                        s.payer,
                        s.merchant,
                        s.payout,
                        s.amount,
                        s.periodSeconds,
                        s.startAt,
                        s.maxCharges,
                        deadline
                    )
                )
            )
        );
    }

    function _permitSig(uint256 pk, address from, uint256 value, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                usdt.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(usdt.PERMIT_TYPEHASH(), from, address(mgr), value, usdt.nonces(from), deadline))
            )
        );
        return _sig(pk, digest);
    }

    function _cancelSig(uint256 pk, bytes32 id, uint256 deadline) internal view returns (bytes memory) {
        return _sig(pk, _mgrDigest(keccak256(abi.encode(mgr.CANCEL_TYPEHASH(), id, deadline))));
    }

    function _subscribe(bytes32 id, ISubscriptionManager.Sub memory s) internal {
        uint256 deadline = T0 + 1 days;
        bytes memory subSig = _subscribeSig(payerPk, id, s, deadline);
        bytes memory permitSig = _permitSig(payerPk, s.payer, uint256(s.amount) * s.maxCharges, deadline);
        vm.prank(relayer);
        mgr.subscribe(id, s, deadline, subSig, uint256(s.amount) * s.maxCharges, deadline, permitSig);
    }

    function _status(bytes32 id) internal view returns (ISubscriptionManager.State memory st) {
        (, st) = mgr.subscription(id);
    }
}

contract SubscriptionManagerTest is SubBase {
    // ================================================================ constructor and views

    function test_constructor_setsConfig() public view {
        assertEq(address(mgr.usdt()), address(usdt));
        assertEq(mgr.owner(), owner);
        assertEq(mgr.guardian(), guardian);
    }

    function test_constructor_zeroAddressesRevert() public {
        vm.expectRevert(ISubscriptionManager.ZeroAddress.selector);
        new SubscriptionManager(address(0), owner, guardian);
        vm.expectRevert(ISubscriptionManager.ZeroAddress.selector);
        new SubscriptionManager(address(usdt), owner, address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new SubscriptionManager(address(usdt), address(0), guardian);
    }

    // ================================================================ subscribe

    function test_subscribe_storesTheAgreementAndGrantsExactlyTheCap() public {
        ISubscriptionManager.Sub memory s = _sub();
        uint256 deadline = T0 + 1 days;
        bytes memory subSig = _subscribeSig(payerPk, ID, s, deadline);
        bytes memory permitSig = _permitSig(payerPk, payer, uint256(AMOUNT) * MAX, deadline);

        vm.expectEmit(true, true, true, true, address(mgr));
        emit ISubscriptionManager.SubscriptionCreated(ID, payer, merchant, payout, AMOUNT, PERIOD, uint64(T0), MAX);
        vm.prank(relayer);
        mgr.subscribe(ID, s, deadline, subSig, uint256(s.amount) * s.maxCharges, deadline, permitSig);

        (ISubscriptionManager.Sub memory stored, ISubscriptionManager.State memory st) = mgr.subscription(ID);
        assertEq(stored.payer, payer);
        assertEq(stored.payout, payout);
        assertEq(stored.amount, AMOUNT);
        assertEq(stored.maxCharges, MAX);
        assertEq(st.nextCharge, T0);
        assertEq(st.charges, 0);
        assertEq(uint8(st.status), uint8(ISubscriptionManager.Status.Active));
        assertEq(usdt.allowance(payer, address(mgr)), uint256(AMOUNT) * MAX); // never unlimited
    }

    function test_subscribe_twiceWithTheSameId_reverts() public {
        _subscribe(ID, _sub());
        ISubscriptionManager.Sub memory s = _sub();
        uint256 deadline = T0 + 1 days;
        bytes memory subSig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.SubscriptionExists.selector);
        mgr.subscribe(ID, s, deadline, subSig, 0, deadline, "");
    }

    function test_subscribe_invalidTerms_revert() public {
        uint256 deadline = T0 + 1 days;
        ISubscriptionManager.Sub memory s = _sub();

        s.amount = 0;
        bytes memory sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.InvalidSubscription.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");

        s = _sub();
        s.periodSeconds = 59; // shorter than the minimum
        sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.InvalidSubscription.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");

        s = _sub();
        s.maxCharges = 0;
        sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.InvalidSubscription.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");

        s = _sub();
        s.maxCharges = 10_001; // above the cap on how long a signature can commit a payer
        sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.InvalidSubscription.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");

        s = _sub();
        s.startAt = uint64(T0 + 367 days); // too far ahead
        sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.InvalidSubscription.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");
    }

    function test_subscribe_zeroAddresses_revert() public {
        uint256 deadline = T0 + 1 days;
        ISubscriptionManager.Sub memory s = _sub();
        s.payout = address(0);
        bytes memory sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.ZeroAddress.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");
        s = _sub();
        s.merchant = address(0);
        sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.ZeroAddress.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");
        s = _sub();
        s.payer = address(0);
        sig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.ZeroAddress.selector);
        mgr.subscribe(ID, s, deadline, sig, 0, deadline, "");
    }

    function test_subscribe_expiredDeadline_reverts() public {
        ISubscriptionManager.Sub memory s = _sub();
        bytes memory sig = _subscribeSig(payerPk, ID, s, T0 - 1);
        vm.expectRevert(ISubscriptionManager.Expired.selector);
        mgr.subscribe(ID, s, T0 - 1, sig, 0, T0 + 1 days, "");
    }

    function test_subscribe_wrongSignerOrTamperedTerms_revert() public {
        uint256 deadline = T0 + 1 days;
        ISubscriptionManager.Sub memory s = _sub();
        bytes memory stranger = _subscribeSig(0xBAD, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.BadSignature.selector);
        mgr.subscribe(ID, s, deadline, stranger, 0, deadline, "");

        bytes memory good = _subscribeSig(payerPk, ID, s, deadline);
        s.payout = relayer; // the relayer tries to redirect the money
        vm.expectRevert(ISubscriptionManager.BadSignature.selector);
        mgr.subscribe(ID, s, deadline, good, 0, deadline, "");

        s = _sub();
        s.amount = AMOUNT * 2;
        vm.expectRevert(ISubscriptionManager.BadSignature.selector);
        mgr.subscribe(ID, s, deadline, good, 0, deadline, "");

        s = _sub();
        vm.expectRevert(ISubscriptionManager.BadSignature.selector);
        mgr.subscribe(keccak256("other id"), s, deadline, good, 0, deadline, ""); // the id is signed too
    }

    function test_subscribe_withoutPermit_usesExistingAllowance_orReverts() public {
        uint256 deadline = T0 + 1 days;
        ISubscriptionManager.Sub memory s = _sub();
        bytes memory subSig = _subscribeSig(payerPk, ID, s, deadline);
        vm.expectRevert(ISubscriptionManager.InsufficientAllowance.selector);
        mgr.subscribe(ID, s, deadline, subSig, 0, deadline, "");

        vm.prank(payer);
        usdt.approve(address(mgr), uint256(AMOUNT) * MAX);
        mgr.subscribe(ID, s, deadline, subSig, 0, deadline, "");
        assertEq(uint8(_status(ID).status), uint8(ISubscriptionManager.Status.Active));
    }

    function test_subscribe_survivesSomeoneFrontRunningThePermit() public {
        uint256 deadline = T0 + 1 days;
        ISubscriptionManager.Sub memory s = _sub();
        bytes memory subSig = _subscribeSig(payerPk, ID, s, deadline);
        bytes memory permitSig = _permitSig(payerPk, payer, uint256(AMOUNT) * MAX, deadline);
        // an attacker submits the permit first, burning its nonce
        vm.prank(makeAddr("attacker"));
        usdt.permit(payer, address(mgr), uint256(AMOUNT) * MAX, deadline, permitSig);
        // the permit call inside subscribe now fails, but the allowance is already there
        mgr.subscribe(ID, s, deadline, subSig, uint256(s.amount) * s.maxCharges, deadline, permitSig);
        assertEq(uint8(_status(ID).status), uint8(ISubscriptionManager.Status.Active));
    }

    function test_subscribe_aBadPermitDoesNotGrantAnythingAndSubscribeReverts() public {
        uint256 deadline = T0 + 1 days;
        ISubscriptionManager.Sub memory s = _sub();
        bytes memory subSig = _subscribeSig(payerPk, ID, s, deadline);
        bytes memory wrongPermit = _permitSig(0xBAD, payer, uint256(AMOUNT) * MAX, deadline);
        vm.expectRevert(ISubscriptionManager.InsufficientAllowance.selector);
        mgr.subscribe(ID, s, deadline, subSig, uint256(s.amount) * s.maxCharges, deadline, wrongPermit);
        assertEq(usdt.allowance(payer, address(mgr)), 0);
    }

    function test_subscribe_smartAccountPayer_viaERC1271() public {
        MockWallet wallet = new MockWallet(payer);
        usdt.mint(address(wallet), 500e6);
        ISubscriptionManager.Sub memory s = _sub();
        s.payer = address(wallet);
        uint256 deadline = T0 + 1 days;
        bytes memory subSig = _subscribeSig(payerPk, ID, s, deadline); // the wallet's owner signs
        bytes memory permitSig = _permitSig(payerPk, address(wallet), uint256(AMOUNT) * MAX, deadline);
        mgr.subscribe(ID, s, deadline, subSig, uint256(s.amount) * s.maxCharges, deadline, permitSig);
        vm.warp(T0);
        mgr.charge(ID);
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(address(wallet)), 500e6 - AMOUNT);
    }

    function test_subscribe_whenPaused_reverts() public {
        ISubscriptionManager.Sub memory s = _sub();
        uint256 deadline = T0 + 1 days;
        bytes memory subSig = _subscribeSig(payerPk, ID, s, deadline);
        vm.prank(guardian);
        mgr.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        mgr.subscribe(ID, s, deadline, subSig, 0, deadline, "");
    }

    function test_twoSubscriptionsByOnePayerCoexist_whenTheSecondPermitAddsToTheAllowance() public {
        _subscribe(ID, _sub());
        bytes32 id2 = keccak256("sub-2");
        ISubscriptionManager.Sub memory s2 = _sub();
        s2.amount = 5e6;
        s2.maxCharges = 4;
        uint256 deadline = T0 + 1 days;
        uint256 total = usdt.allowance(payer, address(mgr)) + uint256(s2.amount) * s2.maxCharges; // 120e6 + 20e6
        bytes memory subSig = _subscribeSig(payerPk, id2, s2, deadline);
        bytes memory permitSig = _permitSig(payerPk, payer, total, deadline);
        mgr.subscribe(id2, s2, deadline, subSig, total, deadline, permitSig);
        assertEq(usdt.allowance(payer, address(mgr)), uint256(AMOUNT) * MAX + 20e6);
        mgr.charge(ID);
        mgr.charge(id2);
        assertEq(usdt.balanceOf(payout), AMOUNT + 5e6);
    }

    function test_aSecondSubscriptionWhosePermitReplacesTheAllowance_isRejectedIfItWouldNotCoverItself() public {
        _subscribe(ID, _sub());
        bytes32 id2 = keccak256("sub-2");
        ISubscriptionManager.Sub memory s2 = _sub();
        s2.amount = 50e6;
        s2.maxCharges = 12; // needs 600e6
        uint256 deadline = T0 + 1 days;
        bytes memory subSig = _subscribeSig(payerPk, id2, s2, deadline);
        bytes memory permitSig = _permitSig(payerPk, payer, 10e6, deadline); // far too small
        vm.expectRevert(ISubscriptionManager.InsufficientAllowance.selector);
        mgr.subscribe(id2, s2, deadline, subSig, 10e6, deadline, permitSig);
    }

    // ================================================================ charge

    function test_charge_beforeDue_reverts_atDueSucceeds() public {
        ISubscriptionManager.Sub memory s = _sub();
        s.startAt = uint64(T0 + 7 days);
        _subscribe(ID, s);
        assertFalse(mgr.isDue(ID));
        vm.warp(T0 + 7 days - 1);
        vm.expectRevert(ISubscriptionManager.NotDue.selector);
        mgr.charge(ID);
        vm.warp(T0 + 7 days); // exactly due: inclusive
        assertTrue(mgr.isDue(ID));
        mgr.charge(ID);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    function test_charge_movesFundsStraightToThePayout_neverHoldsThem_andAdvancesOnePeriod() public {
        _subscribe(ID, _sub());
        vm.expectEmit(true, false, false, true, address(mgr));
        emit ISubscriptionManager.SubscriptionCharged(ID, AMOUNT, 1, uint64(T0 + PERIOD));
        vm.prank(relayer); // anyone may trigger a charge that is due
        mgr.charge(ID);

        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(payer), 1000e6 - AMOUNT);
        assertEq(usdt.balanceOf(address(mgr)), 0);
        ISubscriptionManager.State memory st = _status(ID);
        assertEq(st.charges, 1);
        assertEq(st.nextCharge, T0 + PERIOD);
        assertEq(usdt.allowance(payer, address(mgr)), uint256(AMOUNT) * (MAX - 1)); // allowance shrinks with each charge
    }

    function test_charge_twiceInTheSamePeriod_reverts() public {
        _subscribe(ID, _sub());
        mgr.charge(ID);
        vm.expectRevert(ISubscriptionManager.NotDue.selector);
        mgr.charge(ID);
    }

    function test_charge_eachPeriodOnce_andCompletesAfterMaxCharges() public {
        ISubscriptionManager.Sub memory s = _sub();
        s.maxCharges = 3;
        _subscribe(ID, s);
        for (uint256 i; i < 3; i++) {
            vm.warp(T0 + i * PERIOD);
            mgr.charge(ID);
        }
        assertEq(usdt.balanceOf(payout), 3 * uint256(AMOUNT));
        assertEq(uint8(_status(ID).status), uint8(ISubscriptionManager.Status.Completed));
        vm.warp(T0 + 10 * uint256(PERIOD));
        vm.expectRevert(ISubscriptionManager.NotActive.selector);
        mgr.charge(ID);
        assertEq(usdt.allowance(payer, address(mgr)), 0);
    }

    function test_charge_completedEmitsCompleted() public {
        ISubscriptionManager.Sub memory s = _sub();
        s.maxCharges = 1;
        _subscribe(ID, s);
        vm.expectEmit(true, false, false, false, address(mgr));
        emit ISubscriptionManager.SubscriptionCompleted(ID);
        mgr.charge(ID);
    }

    function test_charge_missedPeriodsAreNotChargedTwice_noCatchUp() public {
        _subscribe(ID, _sub());
        vm.warp(T0 + 5 * uint256(PERIOD) + 3 days); // five periods and a bit late
        mgr.charge(ID);
        assertEq(usdt.balanceOf(payout), AMOUNT); // one charge, not five
        assertEq(_status(ID).nextCharge, block.timestamp + PERIOD); // the next one is a full period from now
        vm.expectRevert(ISubscriptionManager.NotDue.selector);
        mgr.charge(ID);
    }

    function test_charge_exactlyOnePeriodLate_isNotImmediatelyDueAgain() public {
        _subscribe(ID, _sub());
        vm.warp(T0 + PERIOD); // exactly one period after the first charge was due
        mgr.charge(ID);
        assertEq(_status(ID).nextCharge, block.timestamp + PERIOD);
        vm.expectRevert(ISubscriptionManager.NotDue.selector);
        mgr.charge(ID); // no double charge in the same instant
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    function test_charge_oneSecondBeforeAFullPeriodLate_staysOnTheSchedule() public {
        _subscribe(ID, _sub());
        vm.warp(T0 + PERIOD - 1);
        mgr.charge(ID);
        assertEq(_status(ID).nextCharge, T0 + PERIOD);
    }

    function test_charge_slightlyLate_staysOnTheOriginalSchedule() public {
        _subscribe(ID, _sub());
        vm.warp(T0 + 1 hours); // an hour late
        mgr.charge(ID);
        assertEq(_status(ID).nextCharge, T0 + PERIOD); // not shifted by the delay
    }

    function test_charge_insufficientBalance_revertsCleanly_thenWorksAfterTopUp() public {
        ISubscriptionManager.Sub memory s = _sub();
        _subscribe(ID, s);
        vm.prank(payer);
        usdt.transfer(makeAddr("elsewhere"), 1000e6); // payer spends everything
        vm.expectRevert(); // token reverts; the relayer treats this as "past due"
        mgr.charge(ID);
        ISubscriptionManager.State memory st = _status(ID);
        assertEq(st.charges, 0); // nothing moved
        assertEq(st.nextCharge, T0);
        assertEq(uint8(st.status), uint8(ISubscriptionManager.Status.Active));
        usdt.mint(payer, 100e6);
        mgr.charge(ID);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    function test_charge_afterThePayerRevokesTheAllowance_reverts() public {
        _subscribe(ID, _sub());
        vm.prank(payer);
        usdt.approve(address(mgr), 0);
        vm.expectRevert();
        mgr.charge(ID);
        assertEq(_status(ID).charges, 0);
    }

    function test_charge_unknownOrCancelled_reverts() public {
        vm.expectRevert(ISubscriptionManager.NotActive.selector);
        mgr.charge(keccak256("nope"));
        _subscribe(ID, _sub());
        vm.prank(payer);
        mgr.cancel(ID);
        vm.expectRevert(ISubscriptionManager.NotActive.selector);
        mgr.charge(ID);
    }

    function test_charge_whenPaused_reverts_thenWorksAfterUnpause() public {
        _subscribe(ID, _sub());
        vm.prank(guardian);
        mgr.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        mgr.charge(ID);
        vm.prank(owner);
        mgr.unpause();
        mgr.charge(ID);
    }

    function test_charge_payoutIsFixedBySignature_aRelayerCannotRedirectIt() public {
        _subscribe(ID, _sub());
        mgr.charge(ID);
        assertEq(usdt.balanceOf(relayer), 0);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    // ================================================================ cancel

    function test_cancel_byPayer_andByMerchant_stopsFurtherCharges() public {
        _subscribe(ID, _sub());
        vm.expectEmit(true, true, false, false, address(mgr));
        emit ISubscriptionManager.SubscriptionCancelled(ID, payer);
        vm.prank(payer);
        mgr.cancel(ID);
        assertEq(uint8(_status(ID).status), uint8(ISubscriptionManager.Status.Cancelled));

        bytes32 id2 = keccak256("sub-2");
        _subscribe(id2, _sub());
        vm.prank(merchant);
        mgr.cancel(id2);
        assertEq(uint8(_status(id2).status), uint8(ISubscriptionManager.Status.Cancelled));
    }

    function test_cancel_byAStranger_reverts() public {
        _subscribe(ID, _sub());
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ISubscriptionManager.NotAuthorized.selector);
        mgr.cancel(ID);
    }

    function test_cancel_unknownOrAlreadyCancelled_reverts() public {
        vm.prank(payer);
        vm.expectRevert(ISubscriptionManager.NotActive.selector);
        mgr.cancel(keccak256("nope"));
        _subscribe(ID, _sub());
        vm.prank(payer);
        mgr.cancel(ID);
        vm.prank(payer);
        vm.expectRevert(ISubscriptionManager.NotActive.selector);
        mgr.cancel(ID);
    }

    function test_cancelWithSig_worksForARelayer_andIsSingleUse() public {
        _subscribe(ID, _sub());
        bytes memory sig = _cancelSig(payerPk, ID, T0 + 1 days);
        vm.prank(relayer);
        mgr.cancelWithSig(ID, T0 + 1 days, sig);
        assertEq(uint8(_status(ID).status), uint8(ISubscriptionManager.Status.Cancelled));
        vm.expectRevert(ISubscriptionManager.NotActive.selector);
        mgr.cancelWithSig(ID, T0 + 1 days, sig);
    }

    function test_cancelWithSig_rejectsWrongSignerExpiredAndOtherIds() public {
        _subscribe(ID, _sub());
        bytes memory stranger = _cancelSig(0xBAD, ID, T0 + 1 days);
        vm.expectRevert(ISubscriptionManager.BadSignature.selector);
        mgr.cancelWithSig(ID, T0 + 1 days, stranger);

        bytes memory expired = _cancelSig(payerPk, ID, T0 - 1);
        vm.expectRevert(ISubscriptionManager.Expired.selector);
        mgr.cancelWithSig(ID, T0 - 1, expired);

        bytes32 id2 = keccak256("sub-2");
        _subscribe(id2, _sub());
        bytes memory forId1 = _cancelSig(payerPk, ID, T0 + 1 days);
        vm.expectRevert(ISubscriptionManager.BadSignature.selector);
        mgr.cancelWithSig(id2, T0 + 1 days, forId1); // a signature for one subscription cancels no other
    }

    function test_cancelWithSig_aMerchantsSignatureDoesNotCancel() public {
        _subscribe(ID, _sub());
        bytes memory sig = _cancelSig(0xBEEF, ID, T0 + 1 days); // some key that is not the payer's
        vm.expectRevert(ISubscriptionManager.BadSignature.selector);
        mgr.cancelWithSig(ID, T0 + 1 days, sig);
    }

    // ================================================================ admin

    function test_pause_guardianOrOwner_unpauseOwnerOnly() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ISubscriptionManager.NotGuardianOrOwner.selector);
        mgr.pause();
        vm.prank(guardian);
        mgr.pause();
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        mgr.unpause();
        vm.prank(owner);
        mgr.unpause();
        assertFalse(mgr.paused());
    }

    function test_setGuardian_onlyOwner_notZero() public {
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        mgr.setGuardian(guardian);
        vm.startPrank(owner);
        vm.expectRevert(ISubscriptionManager.ZeroAddress.selector);
        mgr.setGuardian(address(0));
        mgr.setGuardian(relayer);
        vm.stopPrank();
        assertEq(mgr.guardian(), relayer);
    }

    function test_ownership_isTwoStep() public {
        address next = makeAddr("next");
        vm.prank(owner);
        mgr.transferOwnership(next);
        assertEq(mgr.owner(), owner);
        vm.prank(next);
        mgr.acceptOwnership();
        assertEq(mgr.owner(), next);
    }

    // ================================================================ fuzz: every number that feeds the math

    function testFuzz_totalPulledNeverExceedsTheSignedCap(
        uint128 amount,
        uint32 maxCharges,
        uint32 period,
        uint8 attempts
    ) public {
        amount = uint128(bound(amount, 1, 50e6));
        maxCharges = uint32(bound(maxCharges, 1, 24));
        period = uint32(bound(period, 60, 90 days));
        usdt.mint(payer, 10_000e6);
        ISubscriptionManager.Sub memory s = _sub();
        s.amount = amount;
        s.maxCharges = maxCharges;
        s.periodSeconds = period;
        _subscribe(ID, s);
        for (uint256 i; i < uint256(attempts) + 1; i++) {
            vm.warp(block.timestamp + (uint256(period) * (i % 3 + 1)) / 2);
            try mgr.charge(ID) {} catch {}
        }
        ISubscriptionManager.State memory st = _status(ID);
        assertLe(st.charges, maxCharges);
        assertEq(usdt.balanceOf(payout), uint256(st.charges) * amount);
        assertLe(usdt.balanceOf(payout), uint256(amount) * maxCharges);
        assertEq(usdt.balanceOf(address(mgr)), 0);
    }

    function testFuzz_nextChargeIsAlwaysAtLeastOnePeriodAfterAChargeAndNeverMovesBackwards(uint32 period, uint32 lateBy)
        public
    {
        period = uint32(bound(period, 60, 90 days));
        lateBy = uint32(bound(lateBy, 0, 400 days));
        ISubscriptionManager.Sub memory s = _sub();
        s.periodSeconds = period;
        _subscribe(ID, s);
        uint64 before = _status(ID).nextCharge;
        vm.warp(T0 + lateBy);
        mgr.charge(ID);
        uint64 next = _status(ID).nextCharge;
        assertGt(next, before);
        assertGt(next, block.timestamp); // never immediately due again
        assertLe(next, block.timestamp + period); // and never more than one period away
    }

    function testFuzz_chargeIsDueExactlyFromStartAt(uint64 startOffset, uint64 at) public {
        startOffset = uint64(bound(startOffset, 0, 300 days));
        at = uint64(bound(at, 0, 400 days));
        ISubscriptionManager.Sub memory s = _sub();
        s.startAt = uint64(T0) + startOffset;
        _subscribe(ID, s);
        vm.warp(T0 + at);
        bool due = block.timestamp >= s.startAt;
        assertEq(mgr.isDue(ID), due);
        if (!due) vm.expectRevert(ISubscriptionManager.NotDue.selector);
        mgr.charge(ID);
    }

    function testFuzz_aSubscriptionOnlyEverMovesTheSignedAmountToTheSignedPayout(address attacker, uint128 amount)
        public
    {
        vm.assume(attacker != payout && attacker != address(0) && attacker != payer && attacker != address(mgr));
        amount = uint128(bound(amount, 1, 100e6));
        ISubscriptionManager.Sub memory s = _sub();
        s.amount = amount;
        _subscribe(ID, s);
        uint256 payerBefore = usdt.balanceOf(payer);
        vm.prank(attacker);
        mgr.charge(ID);
        assertEq(usdt.balanceOf(attacker), 0);
        assertEq(usdt.balanceOf(payout), amount);
        assertEq(usdt.balanceOf(payer), payerBefore - amount);
    }
}
