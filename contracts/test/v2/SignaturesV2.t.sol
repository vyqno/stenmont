// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {InvoiceAck} from "../../src/InvoiceAck.sol";
import {LedgerAnchor} from "../../src/LedgerAnchor.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {BaseV2} from "./BaseV2.t.sol";

contract SignaturesV2Test is BaseV2 {
    InvoiceAck ack;
    LedgerAnchor anchor;

    function setUp() public override {
        super.setUp();
        ack = new InvoiceAck(address(router));
        anchor = new LedgerAnchor();
    }

    function ackSig(bytes32 id, uint128 amount, uint64 due, address buyer, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sig(
            payerPk,
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    ack.domainSeparator(),
                    keccak256(abi.encode(ack.ACK_TYPEHASH(), id, amount, due, buyer, nonce, deadline))
                )
            )
        );
    }

    function testAckEOAReplayAndTermsBinding() public {
        IPaymentRouterV2.CreateInvoice memory r = _req("ack", AMOUNT);
        r.payerLock = payer;
        bytes32 id = _create(r);
        bytes memory bad = ackSig(id, AMOUNT + 1, DUE, payer, 0, T0 + 1 days);
        vm.expectRevert(InvoiceAck.BadSignature.selector);
        ack.acknowledge(id, T0 + 1 days, bad);
        bytes memory sig = ackSig(id, AMOUNT, DUE, payer, 0, T0 + 1 days);
        ack.acknowledge(id, T0 + 1 days, sig);
        assertTrue(ack.isEligible(id));
        assertEq(ack.nonces(payer), 1);
        vm.expectRevert(InvoiceAck.AlreadyAcknowledged.selector);
        ack.acknowledge(id, T0 + 1 days, sig);
    }

    function testAck1271AndDomainSeparation() public {
        address wallet = address(new MockWallet(payer));
        IPaymentRouterV2.CreateInvoice memory r = _req("wallet", AMOUNT);
        r.payerLock = wallet;
        bytes32 id = _create(r);
        bytes memory sig = ackSig(id, AMOUNT, DUE, wallet, 0, T0 + 1 days);
        InvoiceAck other = new InvoiceAck(address(router));
        vm.expectRevert(InvoiceAck.BadSignature.selector);
        other.acknowledge(id, T0 + 1 days, sig);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(InvoiceAck.BadSignature.selector);
        ack.acknowledge(id, T0 + 1 days, sig);
        vm.chainId(block.chainid - 1);
        ack.acknowledge(id, T0 + 1 days, sig);
        assertTrue(ack.isEligible(id));
    }

    function testAckZeroRouterRefused() public {
        vm.expectRevert(InvoiceAck.ZeroAddress.selector);
        new InvoiceAck(address(0));
    }
    function testAckExpiredAndUnlockedRefused() public {
        bytes32 id = _newInvoice("unlocked", AMOUNT);
        vm.expectRevert(InvoiceAck.InvalidInvoice.selector);
        ack.acknowledge(id, T0 + 1 days, "");
        vm.expectRevert(InvoiceAck.Expired.selector);
        ack.acknowledge(id, T0 - 1, "");
    }

    function anchorSig(address m, bytes32 period, bytes32 root, uint256 count, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sig(
            merchantPk,
            keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    anchor.domainSeparator(),
                    keccak256(abi.encode(anchor.ANCHOR_TYPEHASH(), m, period, root, count, nonce, deadline))
                )
            )
        );
    }

    function testAnchorEOAAnd1271Replay() public {
        bytes32 period = keccak256("2026-11");
        bytes32 root = keccak256("ledger");
        bytes memory sig = anchorSig(merchant, period, root, 10, 0, T0 + 1 days);
        anchor.anchor(merchant, period, root, 10, T0 + 1 days, sig);
        (bytes32 stored, uint256 count) = anchor.anchors(merchant, period);
        assertEq(stored, root);
        assertEq(count, 10);
        assertEq(anchor.nonces(merchant), 1);
        vm.expectRevert(LedgerAnchor.AlreadyAnchored.selector);
        anchor.anchor(merchant, period, root, 10, T0 + 1 days, sig);
        address wallet = address(new MockWallet(merchant));
        sig = anchorSig(wallet, period, root, 10, 0, T0 + 1 days);
        anchor.anchor(wallet, period, root, 10, T0 + 1 days, sig);
        assertEq(anchor.nonces(wallet), 1);
    }

    function testAnchorTamperExpiredAndInvalidInput() public {
        bytes memory sig = anchorSig(merchant, "period", "root", 10, 0, T0 + 1 days);
        vm.expectRevert(LedgerAnchor.BadSignature.selector);
        anchor.anchor(merchant, "period", "tamper", 10, T0 + 1 days, sig);
        vm.expectRevert(LedgerAnchor.Expired.selector);
        anchor.anchor(merchant, "period", "root", 10, T0 - 1, sig);
        vm.expectRevert(LedgerAnchor.InvalidAnchor.selector);
        anchor.anchor(merchant, "period", bytes32(0), 10, T0 + 1 days, sig);
        assertEq(anchor.nonces(merchant), 0);
    }
}
