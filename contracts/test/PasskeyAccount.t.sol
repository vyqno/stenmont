// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PasskeyAccount} from "../src/PasskeyAccount.sol";
import {PasskeyAccountFactory} from "../src/PasskeyAccountFactory.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {Base} from "./Base.t.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {SignerP256} from "@openzeppelin/contracts/utils/cryptography/signers/SignerP256.sol";

contract PasskeyAccountTest is Base {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes4 internal constant INVALID = 0xffffffff;
    uint256 internal constant N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;
    bytes1 internal constant UP_UV = 0x05; // user present + user verified

    uint256 internal passkeyPk = 0xC0DE;
    uint256 internal otherPasskeyPk = 0xC0DF;
    bytes32 internal qx;
    bytes32 internal qy;
    PasskeyAccountFactory internal factory;
    PasskeyAccount internal account;

    function setUp() public override {
        super.setUp();
        factory = new PasskeyAccountFactory();
        (qx, qy) = _pub(passkeyPk);
        account = PasskeyAccount(factory.createAccount(qx, qy, bytes32(0)));
    }

    // ------------------------------------------------------------ helpers

    function _pub(uint256 pk) internal view returns (bytes32 x, bytes32 y) {
        (uint256 ux, uint256 uy) = vm.publicKeyP256(pk);
        return (bytes32(ux), bytes32(uy));
    }

    function _indexOf(string memory haystack, string memory needle) internal pure returns (uint256) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        for (uint256 i; i + n.length <= h.length; i++) {
            bool hit = true;
            for (uint256 j; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return i;
        }
        revert("needle not found");
    }

    /// @dev What a browser returns from navigator.credentials.get with challenge = hash.
    function _assertion(uint256 pk, bytes32 hash, bytes1 flags, string memory type_, bool flipS)
        internal
        view
        returns (bytes memory)
    {
        string memory clientData = string.concat(
            '{"type":"',
            type_,
            '","challenge":"',
            Base64.encodeURL(abi.encodePacked(hash)),
            '","origin":"https://app.stenmont.com","crossOrigin":false}'
        );
        bytes memory authData = abi.encodePacked(sha256("app.stenmont.com"), flags, uint32(1));
        bytes32 signed = sha256(abi.encodePacked(authData, sha256(bytes(clientData))));
        (bytes32 r, bytes32 s) = vm.signP256(pk, signed);
        uint256 su = uint256(s);
        if (su > N / 2) su = N - su; // WebAuthn authenticators are not low-s; the contract needs it normalised
        if (flipS) su = N - su;
        // Six fields encoded flat (not as a struct, which would add a leading offset word): this is the wire format the
        // browser code must produce too.
        return abi.encode(
            r, bytes32(su), _indexOf(clientData, '"challenge"'), _indexOf(clientData, '"type"'), authData, clientData
        );
    }

    function _good(bytes32 hash) internal view returns (bytes memory) {
        return _assertion(passkeyPk, hash, UP_UV, "webauthn.get", false);
    }

    // ------------------------------------------------------------ signature validation

    function test_validAssertion_returnsMagic() public view {
        bytes32 hash = keccak256("hello");
        assertEq(account.isValidSignature(hash, _good(hash)), MAGIC);
    }

    function test_tamperedChallenge_returnsInvalid() public view {
        bytes memory sig = _good(keccak256("A"));
        assertEq(account.isValidSignature(keccak256("B"), sig), INVALID);
    }

    function test_highS_returnsInvalid() public view {
        bytes32 hash = keccak256("hello");
        bytes memory sig = _assertion(passkeyPk, hash, UP_UV, "webauthn.get", true);
        assertEq(account.isValidSignature(hash, sig), INVALID);
    }

    function test_wrongKey_returnsInvalid() public view {
        bytes32 hash = keccak256("hello");
        bytes memory sig = _assertion(otherPasskeyPk, hash, UP_UV, "webauthn.get", false);
        assertEq(account.isValidSignature(hash, sig), INVALID);
    }

    function test_userNotPresentOrNotVerified_returnsInvalid() public view {
        bytes32 hash = keccak256("hello");
        assertEq(account.isValidSignature(hash, _assertion(passkeyPk, hash, 0x00, "webauthn.get", false)), INVALID);
        assertEq(account.isValidSignature(hash, _assertion(passkeyPk, hash, 0x01, "webauthn.get", false)), INVALID); // UP only
        assertEq(account.isValidSignature(hash, _assertion(passkeyPk, hash, 0x04, "webauthn.get", false)), INVALID); // UV only
    }

    function test_wrongCeremonyType_returnsInvalid() public view {
        bytes32 hash = keccak256("hello");
        bytes memory sig = _assertion(passkeyPk, hash, UP_UV, "webauthn.create", false);
        assertEq(account.isValidSignature(hash, sig), INVALID);
    }

    function test_garbageSignatures_returnInvalidAndNeverRevert() public view {
        bytes32 hash = keccak256("hello");
        assertEq(account.isValidSignature(hash, ""), INVALID);
        assertEq(account.isValidSignature(hash, hex"1234"), INVALID);
        assertEq(account.isValidSignature(hash, new bytes(0x100)), INVALID);
        assertEq(account.isValidSignature(hash, abi.encodePacked(keccak256("x"), keccak256("y"))), INVALID);
        assertEq(
            account.isValidSignature(hash, abi.encodePacked(keccak256("x"), keccak256("y"), new bytes(500))), INVALID
        );
    }

    function test_assertionForOneAccountDoesNotValidateAnotherAccountsDigest() public {
        // two accounts, same passkey, different salt: a digest binds the account address (the token puts `from` in it)
        PasskeyAccount other = PasskeyAccount(factory.createAccount(qx, qy, bytes32(uint256(1))));
        bytes32 digestForAccount = keccak256(abi.encode("digest", address(account)));
        bytes memory sig = _good(digestForAccount);
        assertEq(account.isValidSignature(digestForAccount, sig), MAGIC);
        bytes32 digestForOther = keccak256(abi.encode("digest", address(other)));
        assertEq(other.isValidSignature(digestForOther, sig), INVALID); // the old signature does not cover the new digest
    }

    function testFuzz_validForTheSignedHash_invalidForAnyOther(bytes32 hash, bytes32 other) public view {
        vm.assume(hash != other);
        bytes memory sig = _good(hash);
        assertEq(account.isValidSignature(hash, sig), MAGIC);
        assertEq(account.isValidSignature(other, sig), INVALID);
    }

    // ------------------------------------------------------------ initialization

    function test_account_isInitializedWithTheKey() public view {
        (bytes32 x, bytes32 y) = account.signer();
        assertEq(x, qx);
        assertEq(y, qy);
    }

    function test_initialize_onlyOnce() public {
        vm.expectRevert(PasskeyAccount.AlreadyInitialized.selector);
        account.initialize(qx, qy);
    }

    function test_implementation_isLocked() public {
        PasskeyAccount impl = PasskeyAccount(factory.implementation());
        vm.expectRevert(PasskeyAccount.AlreadyInitialized.selector);
        impl.initialize(qx, qy);
    }

    function test_initialize_rejectsKeysNotOnTheCurve() public {
        vm.expectRevert(abi.encodeWithSelector(SignerP256.SignerP256InvalidPublicKey.selector, bytes32(0), bytes32(0)));
        factory.createAccount(bytes32(0), bytes32(0), bytes32(0));
        vm.expectRevert();
        factory.createAccount(bytes32(uint256(1)), bytes32(uint256(2)), bytes32(0));
    }

    // ------------------------------------------------------------ factory

    function test_factory_addressIsKnownBeforeDeployment() public {
        bytes32 salt = bytes32(uint256(42));
        address predicted = factory.getAddress(qx, qy, salt);
        assertEq(predicted.code.length, 0);
        address created = factory.createAccount(qx, qy, salt);
        assertEq(created, predicted);
        assertGt(created.code.length, 0);
    }

    function test_factory_createTwiceReturnsTheSameAccount() public {
        address a = factory.createAccount(qx, qy, bytes32(uint256(7)));
        address b = factory.createAccount(qx, qy, bytes32(uint256(7)));
        assertEq(a, b);
    }

    function test_factory_addressDependsOnKeyAndSalt() public view {
        (bytes32 ox, bytes32 oy) = _pub(otherPasskeyPk);
        address a = factory.getAddress(qx, qy, bytes32(0));
        assertTrue(a != factory.getAddress(qx, qy, bytes32(uint256(1))));
        assertTrue(a != factory.getAddress(ox, oy, bytes32(0)));
    }

    function test_factory_nobodyCanDeployTheAddressWithAnotherKey() public {
        (bytes32 ox, bytes32 oy) = _pub(otherPasskeyPk);
        address victim = factory.getAddress(qx, qy, bytes32(uint256(99)));
        vm.prank(makeAddr("attacker"));
        address attackers = factory.createAccount(ox, oy, bytes32(uint256(99)));
        assertTrue(attackers != victim); // the key is part of the address
        assertEq(victim.code.length, 0);
    }

    function test_factory_emitsAccountCreatedOnlyOnce() public {
        bytes32 salt = bytes32(uint256(5));
        address predicted = factory.getAddress(qx, qy, salt);
        vm.expectEmit(true, false, false, true, address(factory));
        emit PasskeyAccountFactory.AccountCreated(predicted, qx, qy, salt);
        factory.createAccount(qx, qy, salt);
        vm.recordLogs();
        factory.createAccount(qx, qy, salt);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    // ------------------------------------------------------------ end to end: a passkey pays an invoice

    function _passkeyPayAuth(bytes32 id, uint128 value, bytes32 salt)
        internal
        view
        returns (IPaymentRouter.Auth memory)
    {
        bytes32 nonce = router.payNonce(id, salt);
        bytes32 digest = _usdtDigest(address(account), value, 0, T0 + 1 days, nonce);
        return IPaymentRouter.Auth({
            payer: address(account), validAfter: 0, validBefore: T0 + 1 days, salt: salt, signature: _good(digest)
        });
    }

    function test_endToEnd_passkeyAccountPaysAnInvoiceThroughTheRouter() public {
        usdt.mint(address(account), 500e6);
        bytes32 id = _newInvoice(keccak256("INV-PK"), AMOUNT);
        IPaymentRouter.Auth memory a = _passkeyPayAuth(id, AMOUNT, keccak256("s"));
        vm.prank(relayer);
        router.pay(id, AMOUNT, a);
        assertEq(router.paidBy(id, address(account)), AMOUNT);
        assertEq(usdt.balanceOf(payout), AMOUNT);
        assertEq(usdt.balanceOf(address(account)), 500e6 - AMOUNT);
        assertEq(usdt.balanceOf(address(router)), 0);
    }

    function test_endToEnd_anotherPasskeyCannotSpendFromTheAccount() public {
        usdt.mint(address(account), 500e6);
        bytes32 id = _newInvoice(keccak256("INV-PK"), AMOUNT);
        bytes32 nonce = router.payNonce(id, keccak256("s"));
        bytes32 digest = _usdtDigest(address(account), AMOUNT, 0, T0 + 1 days, nonce);
        IPaymentRouter.Auth memory a = IPaymentRouter.Auth({
            payer: address(account),
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: keccak256("s"),
            signature: _assertion(otherPasskeyPk, digest, UP_UV, "webauthn.get", false)
        });
        vm.expectRevert(bytes("invalid signature"));
        router.pay(id, AMOUNT, a);
    }

    function test_endToEnd_beforeTheAccountExists_theTokenRejects_afterCreateItWorks() public {
        (bytes32 nx, bytes32 ny) = _pub(0xBADA55);
        address fresh = factory.getAddress(nx, ny, bytes32(0));
        usdt.mint(fresh, 500e6); // anyone can fund the counterfactual address
        bytes32 id = _newInvoice(keccak256("INV-CF"), AMOUNT);
        bytes32 nonce = router.payNonce(id, keccak256("s"));
        bytes32 digest = _usdtDigest(fresh, AMOUNT, 0, T0 + 1 days, nonce);
        IPaymentRouter.Auth memory a = IPaymentRouter.Auth({
            payer: fresh,
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: keccak256("s"),
            signature: _assertion(0xBADA55, digest, UP_UV, "webauthn.get", false)
        });
        vm.expectRevert(bytes("invalid signature")); // no code yet, so no ERC-1271
        router.pay(id, AMOUNT, a);

        factory.createAccount(nx, ny, bytes32(0)); // the relayer deploys it on first use
        router.pay(id, AMOUNT, a);
        assertEq(usdt.balanceOf(payout), AMOUNT);
    }

    // ------------------------------------------------------------ a real browser-style assertion (cross-language vector)

    /// @dev Same bytes as packages/shared/test/webauthn.test.ts: produced outside Foundry, encoded by the TypeScript helper.
    function test_realBrowserVector_validates() public {
        bytes32 vx = 0x05fe80fedc81b78bbd6c429efc0711b7291065b569355bd388821b68f7c25249;
        bytes32 vy = 0x1a1da471c25f67dd6f4f02207fd8938182be138f50d5e02f2447267993125b6d;
        PasskeyAccount a = PasskeyAccount(factory.createAccount(vx, vy, bytes32(0)));
        bytes32 hash = sha256("stenmont webauthn vector");
        bytes memory sig =
            hex"c71b1318b63678d92468c152bdb4cf0b97910e4c347af86f3e07882864c4374b73d4cd288aa5f65bedfaa63a1eca0560efd4f98078fe8819ebdf45e6612ff0da0000000000000000000000000000000000000000000000000000000000000017000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000025202f04926da78dc348a12b16cdf1e242ef13e07c620b54e871be278ed3df3c18050000000100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000897b2274797065223a22776562617574686e2e676574222c226368616c6c656e6765223a22706a6b6e7a316a316a52354d622d5a374f514b4a70524a49317475665046424f736a3255533745307a6530222c226f726967696e223a2268747470733a2f2f6170702e7374656e6d6f6e742e636f6d222c2263726f73734f726967696e223a66616c73657d0000000000000000000000000000000000000000000000";
        assertEq(a.isValidSignature(hash, sig), MAGIC);
        assertEq(a.isValidSignature(keccak256("another digest"), sig), INVALID);
    }
}
