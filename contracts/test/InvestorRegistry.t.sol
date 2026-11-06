// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {MockWallet} from "./mocks/MockWallet.sol";
import {Test} from "forge-std/Test.sol";

contract InvestorRegistryTest is Test {
    InvestorRegistry internal reg;
    address internal owner = makeAddr("owner");
    uint256 internal attesterPk = 0xA77E57;
    address internal attester;
    address internal investor = makeAddr("investor");
    uint256 internal constant T0 = 1_700_000_000;

    function setUp() public {
        vm.warp(T0);
        attester = vm.addr(attesterPk);
        reg = new InvestorRegistry(owner, attester);
    }

    function _sig(address who, uint64 exp, uint256 deadline, uint256 nonce, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                reg.domainSeparator(),
                keccak256(abi.encode(reg.ALLOW_TYPEHASH(), who, exp, deadline, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _allow() internal returns (uint64 exp) {
        exp = uint64(T0 + 30 days);
        reg.allow(investor, exp, T0 + 1 hours, _sig(investor, exp, T0 + 1 hours, reg.nonces(investor), attesterPk));
    }

    function test_constructor() public {
        assertEq(reg.owner(), owner);
        assertEq(reg.attester(), attester);
        vm.expectRevert(InvestorRegistry.ZeroAddress.selector);
        new InvestorRegistry(owner, address(0));
    }

    function test_allow_validAttestation_allows() public {
        assertFalse(reg.isAllowed(investor));
        vm.expectEmit(true, false, false, true, address(reg));
        emit InvestorRegistry.InvestorAllowed(investor, uint64(T0 + 30 days));
        uint64 exp = _allow();
        assertTrue(reg.isAllowed(investor));
        assertEq(reg.allowedUntil(investor), exp);
        assertEq(reg.nonces(investor), 1);
    }

    function test_allow_zeroInvestor_reverts() public {
        vm.expectRevert(InvestorRegistry.ZeroAddress.selector);
        reg.allow(address(0), uint64(T0 + 1 days), T0 + 1 hours, "");
    }

    function test_allow_wrongSigner_reverts() public {
        uint64 exp = uint64(T0 + 30 days);
        bytes memory bad = _sig(investor, exp, T0 + 1 hours, 0, 0xBAD);
        vm.expectRevert(InvestorRegistry.BadAttestation.selector);
        reg.allow(investor, exp, T0 + 1 hours, bad);
    }

    function test_allow_signatureForSomeoneElse_reverts() public {
        uint64 exp = uint64(T0 + 30 days);
        bytes memory forOther = _sig(makeAddr("other"), exp, T0 + 1 hours, 0, attesterPk);
        vm.expectRevert(InvestorRegistry.BadAttestation.selector);
        reg.allow(investor, exp, T0 + 1 hours, forOther);
    }

    function test_allow_tamperedExpiry_reverts() public {
        bytes memory s = _sig(investor, uint64(T0 + 30 days), T0 + 1 hours, 0, attesterPk);
        vm.expectRevert(InvestorRegistry.BadAttestation.selector);
        reg.allow(investor, uint64(T0 + 3000 days), T0 + 1 hours, s);
    }

    function test_allow_expiredDeadline_reverts() public {
        uint64 exp = uint64(T0 + 30 days);
        bytes memory s = _sig(investor, exp, T0 - 1, 0, attesterPk);
        vm.expectRevert(InvestorRegistry.Expired.selector);
        reg.allow(investor, exp, T0 - 1, s);
    }

    function test_allow_entryExpiryInThePast_reverts() public {
        bytes memory s = _sig(investor, uint64(T0), T0 + 1 hours, 0, attesterPk);
        vm.expectRevert(InvestorRegistry.Expired.selector);
        reg.allow(investor, uint64(T0), T0 + 1 hours, s);
    }

    function test_allow_blocked_reverts() public {
        vm.prank(owner);
        reg.setBlocked(investor, true);
        uint64 exp = uint64(T0 + 30 days);
        bytes memory s = _sig(investor, exp, T0 + 1 hours, 0, attesterPk);
        vm.expectRevert(InvestorRegistry.Blocked.selector);
        reg.allow(investor, exp, T0 + 1 hours, s);
    }

    function test_entry_lapsesAtExpiry() public {
        uint64 exp = _allow();
        vm.warp(exp - 1);
        assertTrue(reg.isAllowed(investor));
        vm.warp(exp);
        assertFalse(reg.isAllowed(investor));
    }

    function test_revoke_makesIsAllowedFalse_andOldSignatureCannotReallow() public {
        uint64 exp = uint64(T0 + 30 days);
        bytes memory s = _sig(investor, exp, T0 + 1 hours, 0, attesterPk);
        reg.allow(investor, exp, T0 + 1 hours, s);
        vm.expectEmit(true, false, false, false, address(reg));
        emit InvestorRegistry.InvestorRevoked(investor);
        vm.prank(owner);
        reg.revoke(investor);
        assertFalse(reg.isAllowed(investor));
        vm.expectRevert(InvestorRegistry.BadAttestation.selector); // same signature replayed: nonce moved on
        reg.allow(investor, exp, T0 + 1 hours, s);
        assertFalse(reg.isAllowed(investor));
    }

    function test_revoke_thenFreshAttestation_reallows() public {
        _allow();
        vm.prank(owner);
        reg.revoke(investor);
        _allow();
        assertTrue(reg.isAllowed(investor));
    }

    function test_blocked_overridesAllowedEntry_andUnblockRestores() public {
        _allow();
        vm.prank(owner);
        reg.setBlocked(investor, true);
        assertFalse(reg.isAllowed(investor));
        vm.prank(owner);
        reg.setBlocked(investor, false);
        assertTrue(reg.isAllowed(investor));
    }

    function test_onlyOwner_functions() public {
        address[3] memory callers = [makeAddr("rando"), address(0), address(reg)];
        for (uint256 i; i < 3; i++) {
            vm.startPrank(callers[i]);
            vm.expectRevert();
            reg.revoke(investor);
            vm.expectRevert();
            reg.setBlocked(investor, true);
            vm.expectRevert();
            reg.setAttester(callers[i]);
            vm.stopPrank();
        }
    }

    function test_setAttester() public {
        address a2 = makeAddr("a2");
        vm.prank(owner);
        reg.setAttester(a2);
        assertEq(reg.attester(), a2);
        vm.prank(owner);
        vm.expectRevert(InvestorRegistry.ZeroAddress.selector);
        reg.setAttester(address(0));
        // the old attester no longer works
        uint64 exp = uint64(T0 + 30 days);
        bytes memory s = _sig(investor, exp, T0 + 1 hours, 0, attesterPk);
        vm.expectRevert(InvestorRegistry.BadAttestation.selector);
        reg.allow(investor, exp, T0 + 1 hours, s);
    }

    function test_smartAccountAttester() public {
        MockWallet w = new MockWallet(attester);
        vm.prank(owner);
        reg.setAttester(address(w));
        _allow();
        assertTrue(reg.isAllowed(investor));
    }

    function testFuzz_isAllowed_trueOnlyBeforeExpiry(uint64 exp, uint64 at) public {
        exp = uint64(bound(exp, T0 + 1, type(uint64).max));
        bytes memory s = _sig(investor, exp, T0 + 1 hours, 0, attesterPk);
        reg.allow(investor, exp, T0 + 1 hours, s);
        vm.warp(at);
        assertEq(reg.isAllowed(investor), at < exp);
    }
}
