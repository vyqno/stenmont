// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../../src/InvestorRegistry.sol";
import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {PaymentRouterV2} from "../../src/PaymentRouterV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {MockUSDT} from "../mocks/MockUSDT.sol";
import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";
import {console2} from "forge-std/Test.sol";

/// @dev Random, always-valid sequences: create+list, fund, pay (before and after funding), transfer, revoke and
///      re-allow, time, default. Every action is bounded so a revert is a bug (fail_on_revert = true), except the
///      deliberate attacks, which are wrapped in try/catch and counted if they ever succeed.
contract ClaimHandlerV2 is ClaimBaseV2 {
    bytes32[] public ids;
    uint256 internal counter;
    mapping(bytes32 id => uint8) public lastStatus;
    address public stranger = address(0x57A9);

    uint256 public badTransition; // a claim moved in a way the state machine forbids
    uint256 public attackSucceeded; // a forbidden transfer or fund went through

    uint256 public c_list;
    uint256 public c_fund;
    uint256 public c_pay;
    uint256 public c_transfer;
    uint256 public c_default;
    uint256 public c_revoke;
    uint256 public c_attack;

    constructor(PaymentRouterV2 router_, MockUSDT usdt_, InvoiceClaimV2 claim_, InvestorRegistry reg_) {
        router = router_;
        usdt = usdt_;
        claim = claim_;
        registry = reg_;
        investor = vm.addr(investorPk);
        investor2 = vm.addr(investor2Pk);
        merchant = vm.addr(merchantPk);
        payer = vm.addr(payerPk);
        payer2 = vm.addr(payer2Pk);
        attester = vm.addr(attesterPk);
        usdt.mint(payer, 1e12);
        usdt.mint(payer2, 1e12);
        usdt.mint(investor, 1e12);
        usdt.mint(investor2, 1e12);
    }

    function setUp() public override {} // wired by the constructor

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _pick(uint256 seed) internal view returns (bytes32) {
        return ids[seed % ids.length];
    }

    function _track() internal {
        for (uint256 i; i < ids.length; i++) {
            uint8 prev = lastStatus[ids[i]];
            uint8 cur = uint8(claim.claims(ids[i]).status);
            if (cur != prev) {
                // None->Listed, Listed->Funded|Cancelled, Funded->Settled|Defaulted
                bool ok = (prev == 0 && cur == 1) || (prev == 1 && (cur == 2 || cur == 5))
                    || (prev == 2 && (cur == 3 || cur == 4));
                if (!ok) badTransition++;
                lastStatus[ids[i]] = cur;
            }
        }
    }

    function listNew(uint128 amount, uint16 d, uint16 r, uint32 dueIn) external {
        _list(amount, d, r, dueIn);
    }

    function _list(uint128 amount, uint16 d, uint16 r, uint32 dueIn) internal returns (bytes32 id) {
        if (ids.length >= 40) return bytes32(0);
        amount = uint128(bound(amount, 1e6, 200e6));
        d = uint16(bound(d, 0, 5000));
        r = uint16(bound(r, 0, 10_000 - d));
        IPaymentRouterV2.CreateInvoice memory req = _req(keccak256(abi.encode("ref", ++counter)), amount);
        req.dueDate = uint64(block.timestamp + bound(dueIn, 2 days, 40 days));
        req.deadline = block.timestamp + 1 days;
        id = _create(req);
        uint256 deadline = block.timestamp + 7 days;
        claim.list(
            id,
            d,
            r,
            deadline,
            _termsSig(merchantPk, id, d, r, deadline),
            _hookSig(merchantPk, id, address(claim), deadline)
        );
        ids.push(id);
        lastStatus[id] = 1;
        c_list++;
        _track();
    }

    /// @dev First claim at or after the seed position that has `status`, or zero.
    function _find(uint256 seed, InvoiceClaimV2.ClaimStatus status) internal view returns (bytes32) {
        for (uint256 k; k < ids.length; k++) {
            bytes32 id = ids[((seed % ids.length) + k) % ids.length];
            if (claim.claims(id).status == status) return id;
        }
        return bytes32(0);
    }

    function fund(uint256 idSeed, uint256 who, uint128 amount, uint16 d, uint16 r) external {
        uint256 pk = who % 2 == 0 ? investorPk : investor2Pk;
        if (!registry.isAllowed(vm.addr(pk))) return;
        bytes32 id = ids.length == 0 ? bytes32(0) : _find(idSeed, InvoiceClaimV2.ClaimStatus.Listed);
        if (id == bytes32(0) || block.timestamp > claim.claims(id).fundBy) id = _list(amount, d, r, 20 days);
        if (id == bytes32(0)) return;
        claim.fund(id, _fundAuthAt(pk, id, claim.claims(id).price));
        c_fund++;
        _track();
    }

    function pay(uint256 idSeed, uint256 who, uint128 frac) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(idSeed);
        uint128 left = router.remaining(id);
        if (left == 0) return;
        uint128 value = uint128(bound(frac, 1, left));
        uint256 pk = who % 2 == 0 ? payerPk : payer2Pk;
        bytes32 salt = keccak256(abi.encode("pay", ++counter));
        bytes32 nonce = router.payNonce(id, router.invoices(id).payout, salt);
        uint256 vb = block.timestamp + 1 days;
        bytes32 sh = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), vm.addr(pk), address(router), uint256(value), 0, vb, nonce
            )
        );
        IPaymentRouterV2.Auth memory a = IPaymentRouterV2.Auth({
            payer: vm.addr(pk),
            validAfter: 0,
            validBefore: vb,
            salt: salt,
            signature: _sig(pk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), sh)))
        });
        router.pay(id, value, router.invoices(id).payout, a);
        c_pay++;
        _track();
    }

    function transfer(uint256 idSeed) external {
        bytes32 id = _find(idSeed, InvoiceClaimV2.ClaimStatus.Funded);
        if (id == bytes32(0)) id = _find(idSeed, InvoiceClaimV2.ClaimStatus.Defaulted);
        if (id == bytes32(0)) return;
        address from = claim.ownerOf(uint256(id));
        address to = from == investor ? investor2 : investor;
        if (!registry.isAllowed(from) || !registry.isAllowed(to)) return;
        vm.prank(from);
        claim.transferFrom(from, to, uint256(id));
        c_transfer++;
    }

    /// @dev Tries every forbidden move; any success is counted and fails the invariant.
    function attack(uint256 idSeed) external {
        if (ids.length == 0) return;
        bytes32 id = _pick(idSeed);
        c_attack++;
        InvoiceClaimV2.ClaimStatus s = claim.claims(id).status;
        if (s == InvoiceClaimV2.ClaimStatus.Funded || s == InvoiceClaimV2.ClaimStatus.Defaulted) {
            address from = claim.ownerOf(uint256(id));
            vm.prank(from);
            try claim.transferFrom(from, stranger, uint256(id)) {
                attackSucceeded++;
            } catch {}
        }
        if (s == InvoiceClaimV2.ClaimStatus.Settled) {
            address from = claim.ownerOf(uint256(id));
            vm.prank(from);
            try claim.transferFrom(from, from == investor ? investor2 : investor, uint256(id)) {
                attackSucceeded++;
            } catch {}
        }
        if (s == InvoiceClaimV2.ClaimStatus.Listed || s == InvoiceClaimV2.ClaimStatus.Cancelled) {
            // funding something that is not for sale / not funding with a stranger
            IPaymentRouterV2.Auth memory a = _fundAuthAt(investorPk, id, claim.claims(id).price);
            if (s == InvoiceClaimV2.ClaimStatus.Cancelled) {
                try claim.fund(id, a) {
                    attackSucceeded++;
                } catch {}
            }
        }
        // default before grace
        if (s == InvoiceClaimV2.ClaimStatus.Funded && block.timestamp <= uint256(claim.claims(id).dueDate) + 7 days) {
            try claim.markDefault(id) {
                attackSucceeded++;
            } catch {}
        }
        // a settled or defaulted claim cannot be defaulted again
        if (s == InvoiceClaimV2.ClaimStatus.Settled || s == InvoiceClaimV2.ClaimStatus.Defaulted) {
            try claim.markDefault(id) {
                attackSucceeded++;
            } catch {}
        }
    }

    function markDefault(uint256 idSeed) external {
        bytes32 id = _find(idSeed, InvoiceClaimV2.ClaimStatus.Funded);
        if (id == bytes32(0)) return;
        uint256 ready = uint256(claim.claims(id).dueDate) + 7 days + 1;
        if (block.timestamp < ready) vm.warp(ready);
        claim.markDefault(id);
        c_default++;
        _track();
    }

    function revokeOrAllow(uint256 who) external {
        address a = who % 2 == 0 ? investor : investor2;
        if (registry.isAllowed(a)) {
            vm.prank(registry.owner());
            registry.revoke(a);
        } else {
            uint64 exp = uint64(block.timestamp + 90 days);
            uint256 deadline = block.timestamp + 1 days;
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    registry.domainSeparator(),
                    keccak256(abi.encode(registry.ALLOW_TYPEHASH(), a, exp, deadline, registry.nonces(a)))
                )
            );
            registry.allow(a, exp, deadline, _sig(attesterPk, digest));
        }
        c_revoke++;
    }

    function warp(uint32 secs) external {
        vm.warp(block.timestamp + bound(secs, 10 minutes, 3 days));
    }

    function _fundAuthAt(uint256 pk, bytes32 id, uint128 value) internal view returns (IPaymentRouterV2.Auth memory a) {
        address from = vm.addr(pk);
        bytes32 salt = keccak256(abi.encode("fund", id, from, block.timestamp));
        bytes32 nonce = claim.fundNonce(id, salt);
        uint256 vb = block.timestamp + 1 days;
        bytes32 sh = keccak256(
            abi.encode(usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(claim), uint256(value), 0, vb, nonce)
        );
        a = IPaymentRouterV2.Auth({
            payer: from,
            validAfter: 0,
            validBefore: vb,
            salt: salt,
            signature: _sig(pk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), sh)))
        });
    }
}

contract InvoiceClaimV2InvariantTest is ClaimBaseV2 {
    ClaimHandlerV2 internal h;

    function setUp() public override {
        super.setUp();
        h = new ClaimHandlerV2(router, usdt, claim, registry);
        // the handler calls registry.allow/revoke and needs owner rights only through pranks
        targetContract(address(h));
        // duplicates raise a selector's weight
        bytes4[] memory sel = new bytes4[](13);
        sel[0] = h.listNew.selector;
        sel[1] = h.listNew.selector;
        sel[2] = h.fund.selector;
        sel[3] = h.fund.selector;
        sel[4] = h.fund.selector;
        sel[5] = h.pay.selector;
        sel[6] = h.transfer.selector;
        sel[7] = h.transfer.selector;
        sel[8] = h.attack.selector;
        sel[9] = h.markDefault.selector;
        sel[10] = h.markDefault.selector;
        sel[11] = h.revokeOrAllow.selector;
        sel[12] = h.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    function invariant_noUsdtStuck_balanceEqualsHeldReserves() public view {
        uint256 reserves;
        for (uint256 i; i < h.idsLength(); i++) {
            InvoiceClaimV2.Claim memory c = claim.claims(h.ids(i));
            if (c.status == InvoiceClaimV2.ClaimStatus.Funded) reserves += c.reserve;
        }
        assertEq(usdt.balanceOf(address(claim)), reserves + claim.totalPending(), "claim holds only live reserves");
        assertEq(usdt.balanceOf(address(router)), 0, "router holds nothing");
    }

    function invariant_stateMachineOnlyMovesForward() public view {
        assertEq(h.badTransition(), 0);
        assertEq(h.attackSucceeded(), 0, "a forbidden move succeeded");
    }

    function invariant_onlyAllowlistedActorsEverHoldAClaim() public view {
        for (uint256 i; i < h.idsLength(); i++) {
            bytes32 id = h.ids(i);
            InvoiceClaimV2.ClaimStatus s = claim.claims(id).status;
            if (
                s == InvoiceClaimV2.ClaimStatus.Funded || s == InvoiceClaimV2.ClaimStatus.Settled
                    || s == InvoiceClaimV2.ClaimStatus.Defaulted
            ) {
                address o = claim.ownerOf(uint256(id));
                assertTrue(o == investor || o == investor2, "holder is an allowlisted actor, never the stranger");
            } else {
                assertEq(claim.balanceOf(h.stranger()), 0);
            }
        }
    }

    function invariant_holderNeverReceivesMoreThanFace() public view {
        for (uint256 i; i < h.idsLength(); i++) {
            InvoiceClaimV2.Claim memory c = claim.claims(h.ids(i));
            assertLe(c.toHolder, c.face);
            assertLe(c.reserve, c.price);
            if (c.status == InvoiceClaimV2.ClaimStatus.Settled) assertEq(c.toHolder, c.face);
        }
    }

    function invariant_callSummary() public view {
        console2.log("list/fund/pay", h.c_list(), h.c_fund(), h.c_pay());
        console2.log("transfer/default/attack/revoke", h.c_transfer(), h.c_default(), h.c_attack());
        console2.log("ids", h.idsLength());
    }
}
