// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {PasskeyAccountFactory} from "../../src/PasskeyAccountFactory.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Test} from "forge-std/Test.sol";

interface IRealUSDT {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function decimals() external view returns (uint8);
}

/// @dev Runs the router against the REAL Whitechain Sepolia USDT at a pinned block.
///      forge test --profile fork   (needs an archive RPC; WHITECHAIN_RPC defaults to the public one)
contract PaymentRouterForkTest is Test {
    IRealUSDT internal constant USDT = IRealUSDT(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address internal constant WHALE = 0xc4b02aE9603D3d9CD5653760dbdF337F6c552c0A; // holds test USDT at the pinned block
    uint256 internal constant PINNED_BLOCK = 12_308_524;
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    PaymentRouter internal router;
    uint256 internal merchantPk = 0xBEEF01;
    uint256 internal payerPk = 0xCAFE01;
    address internal merchant;
    address internal payer;
    address internal payout = address(0x9A70);
    address internal owner = address(0x0123);
    uint256 internal validBefore;

    function setUp() public {
        vm.createSelectFork(vm.envOr("WHITECHAIN_RPC", string("https://rpc.testnet.whitechain.io")), PINNED_BLOCK);
        merchant = vm.addr(merchantPk);
        payer = vm.addr(payerPk);
        router = new PaymentRouter(address(USDT), owner, owner, owner, 1000e6);
        validBefore = block.timestamp + 1 days;
        vm.startPrank(WHALE);
        USDT.transfer(payer, 20e6);
        USDT.transfer(merchant, 20e6);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _usdtDigest(address from, uint256 value, bytes32 nonce) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                USDT.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(RECEIVE_TYPEHASH, from, address(router), value, uint256(0), validBefore, nonce))
            )
        );
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _invoice(bytes32 ref, uint128 amount) internal returns (bytes32 id) {
        IPaymentRouter.CreateInvoice memory req = IPaymentRouter.CreateInvoice({
            merchant: merchant,
            ref: ref,
            payout: payout,
            payerLock: address(0),
            amount: amount,
            minPayment: 0,
            dueDate: uint64(block.timestamp + 30 days),
            metaHash: keccak256("meta"),
            deadline: block.timestamp + 1 days
        });
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                router.domainSeparator(),
                keccak256(
                    abi.encode(
                        router.CREATE_INVOICE_TYPEHASH(),
                        req.merchant,
                        req.ref,
                        req.payout,
                        req.payerLock,
                        req.amount,
                        req.minPayment,
                        req.dueDate,
                        req.metaHash,
                        req.deadline
                    )
                )
            )
        );
        router.createInvoice(req, _sig(merchantPk, digest));
        id = router.invoiceIdOf(merchant, ref);
    }

    function _payAuth(address from, uint256 pk, bytes32 id, uint128 value, bytes32 salt)
        internal
        view
        returns (IPaymentRouter.Auth memory)
    {
        bytes32 nonce = router.payNonce(id, salt);
        return IPaymentRouter.Auth({
            payer: from,
            validAfter: 0,
            validBefore: validBefore,
            salt: salt,
            signature: _sig(pk, _usdtDigest(from, value, nonce))
        });
    }

    // ---------------------------------------------------------------- tests

    function test_fork_isWhitechainSepoliaAndUSDTIsSixDecimals() public view {
        assertEq(block.chainid, 1874);
        assertEq(USDT.decimals(), 6);
    }

    function test_fork_realDomainSeparatorMatchesOurAssumption() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Tether USD"),
                keccak256("1"),
                uint256(1874),
                address(USDT)
            )
        );
        assertEq(USDT.DOMAIN_SEPARATOR(), expected);
    }

    function test_fork_payFullWithRealUSDT() public {
        bytes32 id = _invoice(keccak256("INV-1"), 5e6);
        uint256 payerBefore = USDT.balanceOf(payer);
        IPaymentRouter.Auth memory a = _payAuth(payer, payerPk, id, 5e6, keccak256("s1"));
        router.pay(id, 5e6, a);

        assertEq(USDT.balanceOf(payout), 5e6);
        assertEq(USDT.balanceOf(payer), payerBefore - 5e6);
        assertEq(USDT.balanceOf(address(router)), 0);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouter.Status.Paid));
        assertTrue(USDT.authorizationState(payer, router.payNonce(id, keccak256("s1"))));
    }

    function test_fork_replayIsRejectedByRealToken() public {
        bytes32 id = _invoice(keccak256("INV-2"), 10e6);
        IPaymentRouter.Auth memory a = _payAuth(payer, payerPk, id, 4e6, keccak256("s1"));
        router.pay(id, 4e6, a);
        vm.expectRevert();
        router.pay(id, 4e6, a);
        assertEq(router.invoices(id).paid, 4e6);
    }

    function test_fork_relayerCannotRedirectAuthorizationOnRealToken() public {
        bytes32 a = _invoice(keccak256("INV-A"), 5e6);
        bytes32 b = _invoice(keccak256("INV-B"), 5e6);
        IPaymentRouter.Auth memory authForA = _payAuth(payer, payerPk, a, 5e6, keccak256("s1"));
        vm.expectRevert();
        router.pay(b, 5e6, authForA);
        assertEq(USDT.balanceOf(payout), 0);
    }

    function test_fork_smartAccountPayerWorksThroughERC1271() public {
        MockWallet wallet = new MockWallet(payer);
        vm.prank(WHALE);
        USDT.transfer(address(wallet), 5e6);
        bytes32 id = _invoice(keccak256("INV-3"), 5e6);
        IPaymentRouter.Auth memory a = _payAuth(address(wallet), payerPk, id, 5e6, keccak256("s1"));
        router.pay(id, 5e6, a);
        assertEq(USDT.balanceOf(payout), 5e6);
        assertEq(USDT.balanceOf(address(wallet)), 0);
    }

    function test_fork_refundWithRealUSDT() public {
        bytes32 id = _invoice(keccak256("INV-4"), 6e6);
        router.pay(id, 6e6, _payAuth(payer, payerPk, id, 6e6, keccak256("s1")));
        uint256 payerBefore = USDT.balanceOf(payer);
        uint256 merchantBefore = USDT.balanceOf(merchant);

        bytes32 salt = keccak256("r1");
        bytes32 nonce = router.refundNonce(id, payer, salt);
        IPaymentRouter.Auth memory ra = IPaymentRouter.Auth({
            payer: merchant,
            validAfter: 0,
            validBefore: validBefore,
            salt: salt,
            signature: _sig(merchantPk, _usdtDigest(merchant, 2e6, nonce))
        });
        router.refund(id, 2e6, payer, ra);

        assertEq(USDT.balanceOf(payer), payerBefore + 2e6);
        assertEq(USDT.balanceOf(merchant), merchantBefore - 2e6);
        assertEq(USDT.balanceOf(address(router)), 0);
        assertEq(router.invoices(id).refunded, 2e6);
    }

    function test_fork_payerWithoutBalanceReverts() public {
        uint256 brokePk = 0xB0B0;
        bytes32 id = _invoice(keccak256("INV-5"), 5e6);
        IPaymentRouter.Auth memory a = _payAuth(vm.addr(brokePk), brokePk, id, 5e6, keccak256("s1"));
        vm.expectRevert();
        router.pay(id, 5e6, a);
        assertEq(router.invoices(id).paid, 0);
    }

    // ---------------------------------------------------------------- passkey account on the real token

    function _passkeyAssertion(uint256 pk, bytes32 hash) internal view returns (bytes memory) {
        string memory clientData = string.concat(
            '{"type":"webauthn.get","challenge":"',
            Base64.encodeURL(abi.encodePacked(hash)),
            '","origin":"https://app.stenmont.com","crossOrigin":false}'
        );
        bytes memory authData = abi.encodePacked(sha256("app.stenmont.com"), bytes1(0x05), uint32(1));
        (bytes32 r, bytes32 s) = vm.signP256(pk, sha256(abi.encodePacked(authData, sha256(bytes(clientData)))));
        uint256 n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551;
        uint256 su = uint256(s) > n / 2 ? n - uint256(s) : uint256(s);
        return abi.encode(r, bytes32(su), uint256(23), uint256(1), authData, clientData);
    }

    function test_fork_passkeyAccountPaysThroughRealUSDT() public {
        uint256 passkeyPk = 0xC0DE;
        (uint256 ux, uint256 uy) = vm.publicKeyP256(passkeyPk);
        PasskeyAccountFactory factory = new PasskeyAccountFactory();
        address account = factory.createAccount(bytes32(ux), bytes32(uy), bytes32(0));
        vm.prank(WHALE);
        USDT.transfer(account, 5e6);

        bytes32 id = _invoice(keccak256("INV-PK"), 5e6);
        bytes32 salt = keccak256("s1");
        IPaymentRouter.Auth memory a = IPaymentRouter.Auth({
            payer: account,
            validAfter: 0,
            validBefore: validBefore,
            salt: salt,
            signature: _passkeyAssertion(passkeyPk, _usdtDigest(account, 5e6, router.payNonce(id, salt)))
        });
        router.pay(id, 5e6, a); // the real USDT calls PasskeyAccount.isValidSignature over ERC-1271
        assertEq(USDT.balanceOf(payout), 5e6);
        assertEq(USDT.balanceOf(account), 0);
    }
}
