// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../../src/InvestorRegistry.sol";
import {InvoiceClaim} from "../../src/InvoiceClaim.sol";
import {PaymentRouter} from "../../src/PaymentRouter.sol";
import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";
import {Test} from "forge-std/Test.sol";

interface IRealUSDT {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @dev Sells and settles an invoice with the REAL Whitechain Sepolia USDT at a pinned block.
///      forge test --profile fork
contract InvoiceClaimForkTest is Test {
    IRealUSDT internal constant USDT = IRealUSDT(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    address internal constant WHALE = 0xc4b02aE9603D3d9CD5653760dbdF337F6c552c0A;
    uint256 internal constant PINNED_BLOCK = 12_308_524;
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    PaymentRouter internal router;
    InvestorRegistry internal registry;
    InvoiceClaim internal claim;
    uint256 internal merchantPk = 0xBEEF01;
    uint256 internal payerPk = 0xCAFE01;
    uint256 internal investorPk = 0x1A7E57;
    uint256 internal attesterPk = 0xA77E57;
    address internal merchant;
    address internal payer;
    address internal investor;
    address internal payout = address(0x9A70);
    address internal admin = address(0x0123);
    uint256 internal validBefore;
    bytes32 internal id;

    function setUp() public {
        vm.createSelectFork(vm.envOr("WHITECHAIN_RPC", string("https://rpc.testnet.whitechain.io")), PINNED_BLOCK);
        merchant = vm.addr(merchantPk);
        payer = vm.addr(payerPk);
        investor = vm.addr(investorPk);
        router = new PaymentRouter(address(USDT), admin, admin, vm.addr(attesterPk), 1000e6);
        registry = new InvestorRegistry(admin, vm.addr(attesterPk));
        claim = new InvoiceClaim(address(USDT), address(router), address(registry), admin, admin);
        validBefore = block.timestamp + 1 days;
        vm.startPrank(WHALE);
        USDT.transfer(payer, 10e6);
        USDT.transfer(investor, 10e6);
        vm.stopPrank();

        uint64 exp = uint64(block.timestamp + 30 days);
        bytes32 d = keccak256(
            abi.encodePacked(
                "\x19\x01",
                registry.domainSeparator(),
                keccak256(abi.encode(registry.ALLOW_TYPEHASH(), investor, exp, validBefore, uint256(0)))
            )
        );
        registry.allow(investor, exp, validBefore, _sig(attesterPk, d));

        // invoice of 5 USDT, due in 10 days; sell at 4% discount with a 10% reserve
        IPaymentRouter.CreateInvoice memory req = IPaymentRouter.CreateInvoice({
            merchant: merchant,
            ref: keccak256("fork-claim"),
            payout: payout,
            payerLock: address(0),
            amount: 5e6,
            minPayment: 0,
            dueDate: uint64(block.timestamp + 10 days),
            metaHash: keccak256("meta"),
            deadline: validBefore
        });
        router.createInvoice(req, _sig(merchantPk, _routerDigest(_createStruct(req))));
        id = router.invoiceIdOf(merchant, req.ref);
        claim.list(
            id,
            400,
            1000,
            validBefore,
            _sig(
                merchantPk,
                _claimDigest(keccak256(abi.encode(claim.TERMS_TYPEHASH(), id, uint16(400), uint16(1000), validBefore)))
            ),
            _sig(
                merchantPk,
                _routerDigest(keccak256(abi.encode(router.SET_HOOK_TYPEHASH(), id, address(claim), validBefore)))
            )
        );
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _routerDigest(bytes32 sh) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", router.domainSeparator(), sh));
    }

    function _claimDigest(bytes32 sh) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", claim.domainSeparator(), sh));
    }

    function _createStruct(IPaymentRouter.CreateInvoice memory r) internal view returns (bytes32) {
        return keccak256(
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
        );
    }

    function _auth(uint256 pk, address to, bytes32 nonce, uint256 value, bytes32 salt, uint256 vb)
        internal
        view
        returns (IPaymentRouter.Auth memory)
    {
        address from = vm.addr(pk);
        bytes32 sh = keccak256(abi.encode(RECEIVE_TYPEHASH, from, to, value, uint256(0), vb, nonce));
        return IPaymentRouter.Auth({
            payer: from,
            validAfter: 0,
            validBefore: vb,
            salt: salt,
            signature: _sig(pk, keccak256(abi.encodePacked("\x19\x01", USDT.DOMAIN_SEPARATOR(), sh)))
        });
    }

    function _fundAuth() internal view returns (IPaymentRouter.Auth memory) {
        bytes32 salt = keccak256("fund");
        return _auth(investorPk, address(claim), claim.fundNonce(id, salt), 4_800_000, salt, validBefore);
    }

    function _payAuth(uint256 value, bytes32 salt, uint256 vb) internal view returns (IPaymentRouter.Auth memory) {
        return _auth(payerPk, address(router), router.payNonce(id, salt), value, salt, vb);
    }

    // ---------------------------------------------------------------- tests

    function test_fork_sellAndSettleWithRealUSDT() public {
        // price = 5 * 0.96 = 4.8; reserve = 0.5; advance = 4.3
        claim.fund(id, _fundAuth());
        assertEq(USDT.balanceOf(payout), 4_300_000, "merchant paid today");
        assertEq(USDT.balanceOf(address(claim)), 500_000, "reserve held");
        assertEq(claim.ownerOf(uint256(id)), investor);
        uint256 investorBefore = USDT.balanceOf(investor);

        router.pay(id, 5e6, _payAuth(5e6, keccak256("p1"), validBefore));

        assertEq(USDT.balanceOf(investor), investorBefore + 5e6, "investor repaid the full face");
        assertEq(USDT.balanceOf(payout), 4_300_000 + 500_000, "merchant gets the reserve back");
        assertEq(USDT.balanceOf(address(claim)), 0);
        assertEq(USDT.balanceOf(address(router)), 0);
        assertEq(uint8(claim.claims(id).status), uint8(InvoiceClaim.ClaimStatus.Settled));
    }

    function test_fork_defaultPaysReserveToInvestor() public {
        claim.fund(id, _fundAuth());
        uint256 investorBefore = USDT.balanceOf(investor);
        vm.warp(block.timestamp + 10 days + 7 days + 1);
        claim.markDefault(id);
        assertEq(USDT.balanceOf(investor), investorBefore + 500_000);
        assertEq(USDT.balanceOf(address(claim)), 0);
        assertEq(uint8(claim.claims(id).status), uint8(InvoiceClaim.ClaimStatus.Defaulted));
    }

    function test_fork_unlistedInvestorCannotFund() public {
        uint256 strangerPk = 0x57A9;
        vm.prank(WHALE);
        USDT.transfer(vm.addr(strangerPk), 5e6);
        bytes32 salt = keccak256("fund");
        IPaymentRouter.Auth memory a =
            _auth(strangerPk, address(claim), claim.fundNonce(id, salt), 4_800_000, salt, validBefore);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.fund(id, a);
    }

    function test_fork_fundingAuthorizationCannotBeRedirectedToAnotherInvoice() public {
        IPaymentRouter.CreateInvoice memory req = IPaymentRouter.CreateInvoice({
            merchant: merchant,
            ref: keccak256("other"),
            payout: payout,
            payerLock: address(0),
            amount: 5e6,
            minPayment: 0,
            dueDate: uint64(block.timestamp + 10 days),
            metaHash: keccak256("meta"),
            deadline: validBefore
        });
        router.createInvoice(req, _sig(merchantPk, _routerDigest(_createStruct(req))));
        bytes32 other = router.invoiceIdOf(merchant, req.ref);
        claim.list(
            other,
            400,
            1000,
            validBefore,
            _sig(
                merchantPk,
                _claimDigest(
                    keccak256(abi.encode(claim.TERMS_TYPEHASH(), other, uint16(400), uint16(1000), validBefore))
                )
            ),
            _sig(
                merchantPk,
                _routerDigest(keccak256(abi.encode(router.SET_HOOK_TYPEHASH(), other, address(claim), validBefore)))
            )
        );
        IPaymentRouter.Auth memory forFirst = _fundAuth();
        vm.expectRevert();
        claim.fund(other, forFirst);
        assertEq(USDT.balanceOf(address(claim)), 0);
    }

    function test_fork_transferToNonAllowlistedReverts() public {
        claim.fund(id, _fundAuth());
        vm.prank(investor);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.transferFrom(investor, address(0xBAD), uint256(id));
    }
}
