// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {SubscriptionManager} from "../src/SubscriptionManager.sol";
import {ISubscriptionManager} from "../src/interfaces/ISubscriptionManager.sol";
import {SubBase} from "./SubscriptionManager.t.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {console2} from "forge-std/Test.sol";

/// @dev Random sequences of subscribe, charge, cancel, top-up, allowance changes and time. Every action is bounded to be
///      valid, so a run that reverts is a bug (fail_on_revert = true).
contract SubHandler is SubBase {
    uint256[3] internal pks = [uint256(0xA001), 0xA002, 0xA003];
    address[3] public payers;
    address[2] public payouts;
    address[2] public merchants;

    bytes32[] public ids;
    mapping(bytes32 id => uint64) public lastNext;
    uint256 internal counter;
    uint256 public ghostCharged; // total USDT the handler saw move through charge()
    uint256 public calls_subscribe;
    uint256 public calls_charge;
    uint256 public calls_cancel;

    constructor(SubscriptionManager mgr_, MockUSDT usdt_) {
        mgr = mgr_;
        usdt = usdt_;
        for (uint256 i; i < 3; i++) {
            payers[i] = vm.addr(pks[i]);
            usdt.mint(payers[i], 5000e6);
        }
        payouts[0] = address(0x5001);
        payouts[1] = address(0x5002);
        merchants[0] = address(0x6001);
        merchants[1] = address(0x6002);
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function subscribe(uint256 pSeed, uint128 amount, uint32 period, uint32 maxCharges, uint64 startOffset) external {
        uint256 p = pSeed % 3;
        ISubscriptionManager.Sub memory s = ISubscriptionManager.Sub({
            payer: payers[p],
            merchant: merchants[pSeed % 2],
            payout: payouts[(pSeed / 2) % 2],
            amount: uint128(bound(amount, 1, 50e6)),
            periodSeconds: uint32(bound(period, 60, 60 days)),
            startAt: uint64(block.timestamp + bound(startOffset, 0, 30 days)),
            maxCharges: uint32(bound(maxCharges, 1, 12))
        });
        bytes32 id = keccak256(abi.encode("sub", ++counter));
        uint256 deadline = block.timestamp + 1 days;
        bytes memory subSig = _subscribeSig(pks[p], id, s, deadline);
        // top the allowance up so the permit always covers this subscription on top of earlier ones
        uint256 cap = uint256(s.amount) * s.maxCharges;
        uint256 permitValue = usdt.allowance(s.payer, address(mgr)) + cap; // a permit sets the allowance, so add to it
        bytes memory permitSig = _permitSig(pks[p], s.payer, permitValue, deadline);
        mgr.subscribe(id, s, deadline, subSig, permitValue, deadline, permitSig);
        ids.push(id);
        lastNext[id] = s.startAt;
        calls_subscribe++;
    }

    function charge(uint256 idSeed) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        if (!mgr.isDue(id)) return;
        (ISubscriptionManager.Sub memory s,) = mgr.subscription(id);
        if (usdt.balanceOf(s.payer) < s.amount || usdt.allowance(s.payer, address(mgr)) < s.amount) return;
        uint256 before = usdt.balanceOf(s.payout);
        mgr.charge(id);
        ghostCharged += usdt.balanceOf(s.payout) - before;
        ISubscriptionManager.State memory st = _status(id);
        require(st.nextCharge >= lastNext[id], "nextCharge went backwards");
        lastNext[id] = st.nextCharge;
        calls_charge++;
    }

    function cancel(uint256 idSeed, bool byPayer) external {
        if (ids.length == 0) return;
        bytes32 id = ids[idSeed % ids.length];
        if (_status(id).status != ISubscriptionManager.Status.Active) return;
        (ISubscriptionManager.Sub memory s,) = mgr.subscription(id);
        vm.prank(byPayer ? s.payer : s.merchant);
        mgr.cancel(id);
        calls_cancel++;
    }

    function topUp(uint256 pSeed, uint128 amount) external {
        usdt.mint(payers[pSeed % 3], bound(amount, 1, 500e6));
    }

    function revoke(uint256 pSeed) external {
        vm.prank(payers[pSeed % 3]);
        usdt.approve(address(mgr), 0);
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 1, 45 days));
    }
}

contract SubscriptionManagerInvariantTest is SubBase {
    SubHandler internal handler;

    function setUp() public override {
        vm.warp(T0);
        usdt = new MockUSDT();
        mgr = new SubscriptionManager(address(usdt), address(this), address(this));
        handler = new SubHandler(mgr, usdt);
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](6);
        sel[0] = SubHandler.subscribe.selector;
        sel[1] = SubHandler.charge.selector;
        sel[2] = SubHandler.cancel.selector;
        sel[3] = SubHandler.topUp.selector;
        sel[4] = SubHandler.revoke.selector;
        sel[5] = SubHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// custody: the manager never keeps money
    function invariant_managerHoldsNothing() public view {
        assertEq(usdt.balanceOf(address(mgr)), 0);
    }

    /// every charge moved exactly the signed amount to the signed payout, nothing more
    function invariant_payoutsReceivedExactlyWhatWasCharged() public view {
        uint256 received = usdt.balanceOf(handler.payouts(0)) + usdt.balanceOf(handler.payouts(1));
        assertEq(received, handler.ghostCharged());
        uint256 expected;
        for (uint256 i; i < handler.idsLength(); i++) {
            (ISubscriptionManager.Sub memory s, ISubscriptionManager.State memory st) = mgr.subscription(handler.ids(i));
            expected += uint256(st.charges) * s.amount;
        }
        assertEq(expected, handler.ghostCharged(), "sum of charges * amount != money moved");
    }

    /// per subscription: never more charges than signed; status agrees with the count
    function invariant_chargeCountsAndStatusAgree() public view {
        for (uint256 i; i < handler.idsLength(); i++) {
            (ISubscriptionManager.Sub memory s, ISubscriptionManager.State memory st) = mgr.subscription(handler.ids(i));
            assertLe(st.charges, s.maxCharges, "more charges than signed");
            if (st.status == ISubscriptionManager.Status.Completed) assertEq(st.charges, s.maxCharges);
            if (st.status == ISubscriptionManager.Status.Active) assertLt(st.charges, s.maxCharges);
            assertTrue(st.status != ISubscriptionManager.Status.None);
        }
    }

    /// reads the run's statistics (use -vv)
    function afterInvariant() public view {
        console2.log("subscribes", handler.calls_subscribe());
        console2.log("charges", handler.calls_charge());
        console2.log("cancels", handler.calls_cancel());
        console2.log("USDT moved", handler.ghostCharged());
    }
}
