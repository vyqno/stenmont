// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../src/InvestorRegistry.sol";
import {InvoiceClaim} from "../src/InvoiceClaim.sol";
import {IPaymentRouter} from "../src/interfaces/IPaymentRouter.sol";
import {Base} from "./Base.t.sol";
import {MockHook} from "./mocks/MockHook.sol";
import {MockWallet} from "./mocks/MockWallet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Setup and signing helpers shared by the InvoiceClaim unit, fuzz and invariant tests.
abstract contract ClaimBase is Base {
    InvestorRegistry internal registry;
    InvoiceClaim internal claim;

    uint256 internal investorPk = 0x1A7E57;
    address internal investor;
    uint256 internal investor2Pk = 0x1A7E58;
    address internal investor2;

    uint16 internal constant DISCOUNT = 500; // 5%
    uint16 internal constant RESERVE = 1000; // 10%
    uint128 internal constant PRICE = 95e6;
    uint128 internal constant RESERVE_AMT = 10e6;
    uint128 internal constant ADVANCE = 85e6;

    function setUp() public virtual override {
        super.setUp();
        investor = vm.addr(investorPk);
        investor2 = vm.addr(investor2Pk);
        registry = new InvestorRegistry(owner, attester);
        claim = new InvoiceClaim(address(usdt), address(router), address(registry), owner, guardian);
        usdt.mint(investor, 100_000e6);
        usdt.mint(investor2, 100_000e6);
        _allow(investor);
        _allow(investor2);
    }

    function _allow(address who) internal {
        uint64 exp = uint64(T0 + 365 days);
        uint256 deadline = T0 + 1 days;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                registry.domainSeparator(),
                keccak256(abi.encode(registry.ALLOW_TYPEHASH(), who, exp, deadline, registry.nonces(who)))
            )
        );
        registry.allow(who, exp, deadline, _sig(attesterPk, digest));
    }

    function _claimDigest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", claim.domainSeparator(), structHash));
    }

    function _termsSig(uint256 pk, bytes32 id, uint16 d, uint16 r, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _sig(pk, _claimDigest(keccak256(abi.encode(claim.TERMS_TYPEHASH(), id, d, r, deadline))));
    }

    function _list(bytes32 id, uint16 d, uint16 r) internal {
        uint256 deadline = T0 + 1 days;
        vm.prank(relayer);
        claim.list(
            id,
            d,
            r,
            deadline,
            _termsSig(merchantPk, id, d, r, deadline),
            _hookSig(merchantPk, id, address(claim), deadline)
        );
    }

    function _fundAuth(uint256 pk, bytes32 id, uint128 value, bytes32 salt)
        internal
        view
        returns (IPaymentRouter.Auth memory a)
    {
        address from = vm.addr(pk);
        bytes32 nonce = claim.fundNonce(id, salt);
        bytes32 structHash = keccak256(
            abi.encode(usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(claim), value, 0, T0 + 1 days, nonce)
        );
        a = IPaymentRouter.Auth({
            payer: from,
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: salt,
            signature: _sig(pk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash)))
        });
    }

    function _fund(bytes32 id, uint256 pk, uint128 price) internal {
        IPaymentRouter.Auth memory a = _fundAuth(pk, id, price, keccak256("fund"));
        vm.prank(relayer);
        claim.fund(id, a);
    }

    /// @dev invoice of AMOUNT (100 USDT), listed at DISCOUNT/RESERVE
    function _listed(bytes32 ref) internal returns (bytes32 id) {
        id = _newInvoice(ref, AMOUNT);
        _list(id, DISCOUNT, RESERVE);
    }

    function _funded(bytes32 ref) internal returns (bytes32 id) {
        id = _listed(ref);
        _fund(id, investorPk, PRICE);
    }

    function _status(bytes32 id) internal view returns (InvoiceClaim.ClaimStatus) {
        return claim.claims(id).status;
    }
}

contract InvoiceClaimTest is ClaimBase {
    bytes32 internal constant REF = keccak256("INV-1");

    // ------------------------------------------------------------------ constructor / views

    function test_constructor_zeroAddresses_revert() public {
        address a = address(1);
        vm.expectRevert(InvoiceClaim.ZeroAddress.selector);
        new InvoiceClaim(address(0), a, a, a, a);
        vm.expectRevert(InvoiceClaim.ZeroAddress.selector);
        new InvoiceClaim(a, address(0), a, a, a);
        vm.expectRevert(InvoiceClaim.ZeroAddress.selector);
        new InvoiceClaim(a, a, address(0), a, a);
        vm.expectRevert(InvoiceClaim.ZeroAddress.selector);
        new InvoiceClaim(a, a, a, a, address(0));
    }

    function test_constructor_setsWiring() public view {
        assertEq(address(claim.usdt()), address(usdt));
        assertEq(address(claim.router()), address(router));
        assertEq(address(claim.registry()), address(registry));
        assertEq(claim.owner(), owner);
        assertEq(claim.guardian(), guardian);
        assertEq(claim.name(), "Stenmont Invoice Claim");
        assertEq(claim.GRACE(), 7 days);
    }

    function test_quote_math() public view {
        (uint128 p, uint128 r) = claim.quote(100e6, 500, 1000);
        assertEq(p, 95e6);
        assertEq(r, 10e6);
        (p, r) = claim.quote(1, 0, 10_000); // par sale, all reserve
        assertEq(p, 1);
        assertEq(r, 1);
    }

    function test_quote_badBps_reverts() public {
        vm.expectRevert(InvoiceClaim.BadTerms.selector);
        claim.quote(100e6, 10_000, 0); // 100% discount
        vm.expectRevert(InvoiceClaim.BadTerms.selector);
        claim.quote(100e6, 9000, 1001); // reserve above price
    }

    // ------------------------------------------------------------------ list

    function test_list_setsHookAndClaim() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        vm.expectEmit(true, true, false, true, address(claim));
        emit InvoiceClaim.ClaimListed(id, merchant, AMOUNT, PRICE, RESERVE_AMT, uint64(T0 + 30 days));
        _list(id, DISCOUNT, RESERVE);

        assertEq(router.invoices(id).hook, address(claim));
        InvoiceClaim.Claim memory c = claim.claims(id);
        assertEq(c.payee, payout);
        assertEq(c.face, AMOUNT);
        assertEq(c.price, PRICE);
        assertEq(c.reserve, RESERVE_AMT);
        assertEq(c.dueDate, uint64(T0 + 30 days));
        assertEq(c.fundBy, uint64(T0 + 1 days));
        assertEq(uint8(c.status), uint8(InvoiceClaim.ClaimStatus.Listed));
    }

    function test_list_fundByIsCappedAtDueDate() public {
        IPaymentRouter.CreateInvoice memory r = _req(keccak256("short"), AMOUNT);
        r.dueDate = uint64(T0 + 12 hours);
        bytes32 id = _create(r);
        _list(id, DISCOUNT, RESERVE); // deadline = T0 + 1 day > dueDate
        assertEq(claim.claims(id).fundBy, uint64(T0 + 12 hours));
    }

    function test_list_expiredDeadline_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 - 1;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.Expired.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_twice_reverts_AlreadyListed() public {
        bytes32 id = _listed(REF);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.AlreadyListed.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_unknownInvoice_reverts() public {
        bytes32 id = keccak256("nope");
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_partlyPaidInvoice_reverts() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF, AMOUNT);
        bytes32 id = _create(r);
        _pay(id, 10e6, payerPk, keccak256("s"));
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_cancelledInvoice_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        router.cancel(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_invoiceWithOtherHook_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        MockHook other = new MockHook();
        router.setHook(id, address(other), T0 + 1 days, _hookSig(merchantPk, id, address(other), T0 + 1 days));
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_noDueDate_reverts() public {
        IPaymentRouter.CreateInvoice memory r = _req(REF, AMOUNT);
        r.dueDate = 0;
        bytes32 id = _create(r);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_pastDueDate_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 40 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.warp(T0 + 31 days);
        vm.expectRevert(InvoiceClaim.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_termsSignedBySomeoneElse_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(payerPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.BadSignature.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_termsTamperedByRelayer_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.BadSignature.selector);
        claim.list(id, 9000, RESERVE, deadline, ts, hs); // a deeper discount than the merchant signed
    }

    function test_list_badHookSignature_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(payerPk, id, address(claim), deadline);
        vm.expectRevert(IPaymentRouter.BadSignature.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.None)); // all or nothing
    }

    function test_list_badBps_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, 10_000, 0, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.BadTerms.selector);
        claim.list(id, 10_000, 0, deadline, ts, hs);
    }

    function test_list_zeroPrice_reverts() public {
        bytes32 id = _newInvoice(REF, 1); // face 1 base unit at 50% discount rounds to a price of 0
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, 5000, 0, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaim.ZeroAmount.selector);
        claim.list(id, 5000, 0, deadline, ts, hs);
    }

    function test_list_paused_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        vm.prank(guardian);
        claim.pause();
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert();
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_smartAccountMerchant() public {
        MockWallet wallet = new MockWallet(merchant);
        IPaymentRouter.CreateInvoice memory r = _req(REF, AMOUNT);
        r.merchant = address(wallet);
        bytes32 id = router.invoiceIdOf(address(wallet), REF);
        router.createInvoice(r, _sig(merchantPk, _createHash(r)));
        uint256 deadline = T0 + 1 days;
        claim.list(
            id,
            DISCOUNT,
            RESERVE,
            deadline,
            _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline),
            _hookSig(merchantPk, id, address(claim), deadline)
        );
        assertEq(router.invoices(id).hook, address(claim));
    }

    // ------------------------------------------------------------------ fund

    function test_fund_paysMerchantPriceMinusReserve_andMints() public {
        bytes32 id = _listed(REF);
        uint256 inv0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);

        vm.expectEmit(true, true, false, true, address(claim));
        emit InvoiceClaim.ClaimFunded(id, investor, PRICE, ADVANCE);
        _fund(id, investorPk, PRICE);

        assertEq(usdt.balanceOf(investor), inv0 - PRICE);
        assertEq(usdt.balanceOf(payout), pay0 + ADVANCE);
        assertEq(usdt.balanceOf(address(claim)), RESERVE_AMT);
        assertEq(claim.ownerOf(uint256(id)), investor);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Funded));
    }

    function test_fund_reserveEqualsPrice_noAdvanceTransfer() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        _list(id, 0, 10_000); // par sale, the entire price is reserve
        _fund(id, investorPk, AMOUNT);
        assertEq(usdt.balanceOf(address(claim)), AMOUNT);
        assertEq(usdt.balanceOf(payout), 0);
    }

    function test_fund_notListed_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        IPaymentRouter.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaim.NotListed.selector);
        claim.fund(id, a);
    }

    function test_fund_twice_reverts() public {
        bytes32 id = _funded(REF);
        IPaymentRouter.Auth memory a = _fundAuth(investor2Pk, id, PRICE, keccak256("again"));
        vm.expectRevert(InvoiceClaim.NotListed.selector);
        claim.fund(id, a);
    }

    function test_fund_afterFundBy_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouter.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.warp(T0 + 1 days + 1);
        vm.expectRevert(InvoiceClaim.Expired.selector);
        claim.fund(id, a);
    }

    function test_fund_neverAllowlisted_reverts() public {
        bytes32 id = _listed(REF);
        uint256 strangerPk = 0x57A9;
        usdt.mint(vm.addr(strangerPk), PRICE);
        IPaymentRouter.Auth memory a = _fundAuth(strangerPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.fund(id, a);
    }

    function test_fund_revokedInvestor_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouter.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.prank(owner);
        registry.revoke(investor);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.fund(id, a);
    }

    function test_fund_blockedInvestor_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouter.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.prank(owner);
        registry.setBlocked(investor, true);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.fund(id, a);
    }

    function test_fund_invoiceCancelledAfterListing_reverts() public {
        bytes32 id = _listed(REF);
        router.cancel(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        IPaymentRouter.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaim.InvoiceNotSellable.selector);
        claim.fund(id, a);
    }

    function test_fund_wrongSigner_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouter.Auth memory a = _fundAuth(investor2Pk, id, PRICE, keccak256("fund"));
        a.payer = investor; // claim to be investor but signed by investor2
        vm.expectRevert();
        claim.fund(id, a);
    }

    function test_fund_authorizationForOtherInvoiceCannotBeRedirected() public {
        bytes32 a1 = _listed(keccak256("A"));
        bytes32 b1 = _listed(keccak256("B"));
        IPaymentRouter.Auth memory authA = _fundAuth(investorPk, a1, PRICE, keccak256("fund"));
        vm.expectRevert();
        claim.fund(b1, authA);
        assertEq(usdt.balanceOf(address(claim)), 0);
    }

    function test_fund_paused_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouter.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.prank(owner);
        claim.pause();
        vm.expectRevert();
        claim.fund(id, a);
    }

    function test_fund_smartAccountInvestor() public {
        MockWallet wallet = new MockWallet(vm.addr(0x5A17));
        usdt.mint(address(wallet), PRICE);
        // allow the wallet
        uint64 exp = uint64(T0 + 100 days);
        bytes32 d = keccak256(
            abi.encodePacked(
                "\x19\x01",
                registry.domainSeparator(),
                keccak256(abi.encode(registry.ALLOW_TYPEHASH(), address(wallet), exp, T0 + 1 days, uint256(0)))
            )
        );
        registry.allow(address(wallet), exp, T0 + 1 days, _sig(attesterPk, d));
        bytes32 id = _listed(REF);
        IPaymentRouter.Auth memory a = _fundAuth(0x5A17, id, PRICE, keccak256("fund"));
        a.payer = address(wallet);
        // digest was built for vm.addr(0x5A17) as `from`; rebuild for the wallet
        bytes32 nonce = claim.fundNonce(id, a.salt);
        bytes32 sh = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                address(wallet),
                address(claim),
                PRICE,
                0,
                T0 + 1 days,
                nonce
            )
        );
        a.signature = _sig(0x5A17, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), sh)));
        claim.fund(id, a);
        assertEq(claim.ownerOf(uint256(id)), address(wallet));
    }

    // ------------------------------------------------------------------ payments

    function test_payerPays_routesToInvestor_andReleasesReserve() public {
        bytes32 id = _funded(REF);
        uint256 inv0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);

        _pay(id, AMOUNT, payerPk, keccak256("p1"));

        assertEq(usdt.balanceOf(investor), inv0 + AMOUNT, "holder gets the face");
        assertEq(usdt.balanceOf(payout), pay0 + RESERVE_AMT, "merchant gets the reserve back");
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Settled));
        assertEq(claim.claims(id).received, AMOUNT);
    }

    function test_partialPayments_goToHolder_thenSettle() public {
        bytes32 id = _funded(REF);
        uint256 inv0 = usdt.balanceOf(investor);
        _pay(id, 40e6, payerPk, keccak256("p1"));
        assertEq(usdt.balanceOf(investor), inv0 + 40e6);
        assertEq(usdt.balanceOf(address(claim)), RESERVE_AMT);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Funded));
        _pay(id, 60e6, payer2Pk, keccak256("p2"));
        assertEq(usdt.balanceOf(investor), inv0 + AMOUNT);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Settled));
    }

    function test_payingWhileListed_goesToMerchant_andVoidsTheListing() public {
        bytes32 id = _listed(REF);
        uint256 pay0 = usdt.balanceOf(payout);
        _pay(id, 30e6, payerPk, keccak256("p1"));
        assertEq(usdt.balanceOf(payout), pay0 + 30e6);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Cancelled));

        // an investor can no longer fund it
        IPaymentRouter.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaim.NotListed.selector);
        claim.fund(id, a);

        // later payments still reach the merchant
        _pay(id, 70e6, payer2Pk, keccak256("p2"));
        assertEq(usdt.balanceOf(payout), pay0 + 100e6);
        assertEq(usdt.balanceOf(address(claim)), 0);
    }

    function test_onPaid_notRouter_reverts() public {
        bytes32 id = _funded(REF);
        vm.expectRevert(InvoiceClaim.NotRouter.selector);
        claim.onPaid(id, 1);
        vm.prank(merchant);
        vm.expectRevert(InvoiceClaim.NotRouter.selector);
        claim.onPaid(id, 1);
        vm.prank(address(claim));
        vm.expectRevert(InvoiceClaim.NotRouter.selector);
        claim.onPaid(id, 1);
    }

    function test_onPaid_unknownClaim_reverts_soTheRouterRevertsToo() public {
        // a merchant who signed SetHook to the claim contract without listing: payments must not strand money
        bytes32 id = _newInvoice(REF, AMOUNT);
        router.setHook(id, address(claim), T0 + 1 days, _hookSig(merchantPk, id, address(claim), T0 + 1 days));
        IPaymentRouter.Auth memory a = _payAuth(payerPk, id, 10e6, keccak256("s"));
        vm.expectRevert(InvoiceClaim.NotListed.selector);
        router.pay(id, 10e6, a);
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(router.invoices(id).paid, 0);
    }

    function test_onPaid_afterSettled_goesToMerchant() public {
        bytes32 id = _funded(REF);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        // unreachable through the router (invoice is Paid); exercised directly to prove the money is not mis-sent
        usdt.mint(address(claim), 5e6);
        uint256 pay0 = usdt.balanceOf(payout);
        vm.prank(address(router));
        claim.onPaid(id, 5e6);
        assertEq(usdt.balanceOf(payout), pay0 + 5e6);
    }

    function test_payment_followsTheCurrentHolder() public {
        bytes32 id = _funded(REF);
        vm.prank(investor);
        claim.transferFrom(investor, investor2, uint256(id));
        uint256 i2 = usdt.balanceOf(investor2);
        uint256 i1 = usdt.balanceOf(investor);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        assertEq(usdt.balanceOf(investor2), i2 + AMOUNT);
        assertEq(usdt.balanceOf(investor), i1);
    }

    function test_refusedHolderPayout_isCredited_notReverted() public {
        bytes32 id = _funded(REF);
        vm.mockCallRevert(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(AMOUNT))), "blocked");
        vm.expectEmit(true, false, false, true, address(claim));
        emit InvoiceClaim.PayoutDeferred(investor, AMOUNT);
        _pay(id, AMOUNT, payerPk, keccak256("p1")); // the customer's payment still succeeds
        assertEq(claim.pending(investor), AMOUNT);
        assertEq(claim.totalPending(), AMOUNT);
        assertEq(usdt.balanceOf(address(claim)), AMOUNT); // reserve released to the merchant, face is waiting

        vm.clearMockedCalls();
        uint256 before = usdt.balanceOf(investor2);
        vm.prank(investor);
        claim.withdrawPending(investor2);
        assertEq(usdt.balanceOf(investor2), before + AMOUNT);
        assertEq(claim.pending(investor), 0);
        assertEq(claim.totalPending(), 0);
        assertEq(usdt.balanceOf(address(claim)), 0);
    }

    function test_tokenReturningFalse_isCreditedToo() public {
        bytes32 id = _funded(REF);
        vm.mockCall(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(AMOUNT))), abi.encode(false));
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        assertEq(claim.pending(investor), AMOUNT);
    }

    function test_tokenReturningNothing_isTreatedAsSuccess() public {
        bytes32 id = _funded(REF);
        vm.mockCall(address(usdt), abi.encodeCall(IERC20.transfer, (investor, uint256(AMOUNT))), "");
        _pay(id, AMOUNT, payerPk, keccak256("p1")); // mocked transfer does nothing and returns no data
        assertEq(claim.pending(investor), 0);
    }

    // ------------------------------------------------------------------ default

    function test_markDefault_beforeGrace_reverts() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 30 days + 7 days); // exactly the end of grace: still not allowed
        vm.expectRevert(InvoiceClaim.GraceNotOver.selector);
        claim.markDefault(id);
    }

    function test_markDefault_afterGrace_reserveToInvestor() public {
        bytes32 id = _funded(REF);
        uint256 i0 = usdt.balanceOf(investor);
        vm.warp(T0 + 30 days + 7 days + 1);
        vm.expectEmit(true, true, false, true, address(claim));
        emit InvoiceClaim.ClaimDefaulted(id, investor, RESERVE_AMT);
        vm.prank(makeAddr("anyone"));
        claim.markDefault(id);
        assertEq(usdt.balanceOf(investor), i0 + RESERVE_AMT);
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Defaulted));
        assertEq(claim.claims(id).toHolder, RESERVE_AMT);
    }

    function test_markDefault_twice_reverts_reserveNeverPaidTwice() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        claim.markDefault(id);
        vm.expectRevert(InvoiceClaim.NotFunded.selector);
        claim.markDefault(id);
    }

    function test_markDefault_notFunded_reverts() public {
        bytes32 id = _listed(REF);
        vm.warp(T0 + 40 days);
        vm.expectRevert(InvoiceClaim.NotFunded.selector);
        claim.markDefault(id);
    }

    function test_markDefault_afterSettled_reverts() public {
        bytes32 id = _funded(REF);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        vm.warp(T0 + 40 days);
        vm.expectRevert(InvoiceClaim.NotFunded.selector);
        claim.markDefault(id);
    }

    function test_markDefault_paused_reverts() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        vm.prank(guardian);
        claim.pause();
        vm.expectRevert();
        claim.markDefault(id);
    }

    function test_markDefault_afterPartialPayment_reserveIsCappedAtWhatIsOwed() public {
        bytes32 id = _funded(REF);
        _pay(id, 95e6, payerPk, keccak256("p1")); // 5 left; reserve is 10
        uint256 i0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);
        vm.warp(T0 + 40 days);
        claim.markDefault(id);
        assertEq(usdt.balanceOf(investor), i0 + 5e6, "investor made whole, no more");
        assertEq(usdt.balanceOf(payout), pay0 + 5e6, "the rest of the reserve goes back to the merchant");
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(claim.claims(id).toHolder, AMOUNT);
    }

    function test_latePaymentAfterDefault_topsUpHolderUpToFace_restToMerchant() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        claim.markDefault(id); // holder has 10 of 100
        uint256 i0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);
        // invoice still open on the router: the payer settles late
        IPaymentRouter.Auth memory a = IPaymentRouter.Auth({
            payer: payer, validAfter: 0, validBefore: T0 + 60 days, salt: keccak256("late"), signature: ""
        });
        bytes32 nonce = router.payNonce(id, a.salt);
        bytes32 sh = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                payer,
                address(router),
                uint256(AMOUNT),
                0,
                T0 + 60 days,
                nonce
            )
        );
        a.signature = _sig(payerPk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), sh)));
        router.pay(id, AMOUNT, a);
        assertEq(usdt.balanceOf(investor), i0 + 90e6, "holder topped up to face (10 reserve + 90)");
        assertEq(usdt.balanceOf(payout), pay0 + 10e6, "the merchant keeps the surplus");
        assertEq(uint8(_status(id)), uint8(InvoiceClaim.ClaimStatus.Defaulted));
        assertEq(usdt.balanceOf(address(claim)), 0);
    }

    function test_paymentAfterDefaultAndFullCompensation_goesEntirelyToMerchant() public {
        bytes32 id = _funded(REF);
        _pay(id, 95e6, payerPk, keccak256("p1"));
        vm.warp(T0 + 40 days);
        claim.markDefault(id); // holder is now at exactly face
        assertEq(claim.claims(id).toHolder, AMOUNT);
        uint256 i0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);
        usdt.mint(address(claim), 5e6); // emulate the router transferring the late 5
        vm.prank(address(router));
        claim.onPaid(id, 5e6);
        assertEq(usdt.balanceOf(investor), i0);
        assertEq(usdt.balanceOf(payout), pay0 + 5e6);
    }

    // ------------------------------------------------------------------ transfers

    function test_transfer_toAllowlisted_ok() public {
        bytes32 id = _funded(REF);
        vm.prank(investor);
        claim.transferFrom(investor, investor2, uint256(id));
        assertEq(claim.ownerOf(uint256(id)), investor2);
    }

    function test_transfer_safeTransferToAllowlistedContract_ok() public {
        bytes32 id = _funded(REF);
        Receiver r = new Receiver();
        _allowAddr(address(r));
        vm.prank(investor);
        claim.safeTransferFrom(investor, address(r), uint256(id));
        assertEq(claim.ownerOf(uint256(id)), address(r));
    }

    function test_transfer_approvedOperator_ok() public {
        bytes32 id = _funded(REF);
        address op = makeAddr("operator");
        vm.prank(investor);
        claim.approve(op, uint256(id));
        vm.prank(op);
        claim.transferFrom(investor, investor2, uint256(id));
        assertEq(claim.ownerOf(uint256(id)), investor2);
    }

    function test_transfer_toNonAllowlisted_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.transferFrom(investor, makeAddr("stranger"), uint256(id));
    }

    function test_transfer_toBlockedAccount_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        registry.setBlocked(investor2, true);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.transferFrom(investor, investor2, uint256(id));
    }

    function test_transfer_fromRevokedHolder_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        registry.revoke(investor);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.transferFrom(investor, investor2, uint256(id));
        // but they still get paid
        uint256 i0 = usdt.balanceOf(investor);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        assertEq(usdt.balanceOf(investor), i0 + AMOUNT);
    }

    function test_transfer_toAccountWhoseEntryExpired_reverts() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 366 days);
        vm.prank(investor);
        vm.expectRevert(InvoiceClaim.NotAllowlisted.selector);
        claim.transferFrom(investor, investor2, uint256(id));
    }

    function test_transfer_afterSettled_reverts() public {
        bytes32 id = _funded(REF);
        _pay(id, AMOUNT, payerPk, keccak256("p1"));
        vm.prank(investor);
        vm.expectRevert(InvoiceClaim.TransferLocked.selector);
        claim.transferFrom(investor, investor2, uint256(id));
    }

    function test_transfer_afterDefault_ok() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        claim.markDefault(id);
        vm.prank(investor);
        claim.transferFrom(investor, investor2, uint256(id));
        assertEq(claim.ownerOf(uint256(id)), investor2);
    }

    function test_transfer_paused_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        claim.pause();
        vm.prank(investor);
        vm.expectRevert();
        claim.transferFrom(investor, investor2, uint256(id));
    }

    function test_transfer_byNonOwnerNonApproved_reverts() public {
        bytes32 id = _funded(REF);
        vm.prank(investor2);
        vm.expectRevert();
        claim.transferFrom(investor, investor2, uint256(id));
    }

    function test_payments_stillWorkWhilePaused() public {
        bytes32 id = _funded(REF);
        vm.prank(owner);
        claim.pause();
        uint256 i0 = usdt.balanceOf(investor);
        _pay(id, AMOUNT, payerPk, keccak256("p1")); // a pause never traps the customer's payment
        assertEq(usdt.balanceOf(investor), i0 + AMOUNT);
    }

    function _allowAddr(address who) internal {
        uint64 exp = uint64(T0 + 100 days);
        bytes32 d = keccak256(
            abi.encodePacked(
                "\x19\x01",
                registry.domainSeparator(),
                keccak256(abi.encode(registry.ALLOW_TYPEHASH(), who, exp, T0 + 1 days, registry.nonces(who)))
            )
        );
        registry.allow(who, exp, T0 + 1 days, _sig(attesterPk, d));
    }

    // ------------------------------------------------------------------ withdrawPending

    function test_withdrawPending_nothing_reverts() public {
        vm.expectRevert(InvoiceClaim.NothingPending.selector);
        claim.withdrawPending(investor);
    }

    function test_withdrawPending_zeroTo_reverts() public {
        vm.expectRevert(InvoiceClaim.ZeroAddress.selector);
        claim.withdrawPending(address(0));
    }

    // ------------------------------------------------------------------ admin

    function test_pause_guardianOwner_ok_othersRevert() public {
        vm.prank(guardian);
        claim.pause();
        assertTrue(claim.paused());
        vm.prank(owner);
        claim.unpause();
        vm.prank(owner);
        claim.pause();
        assertTrue(claim.paused());
        vm.prank(owner);
        claim.unpause();

        vm.prank(makeAddr("rando"));
        vm.expectRevert(InvoiceClaim.NotGuardianOrOwner.selector);
        claim.pause();
        vm.prank(address(0));
        vm.expectRevert(InvoiceClaim.NotGuardianOrOwner.selector);
        claim.pause();
        vm.prank(address(claim));
        vm.expectRevert(InvoiceClaim.NotGuardianOrOwner.selector);
        claim.pause();
    }

    function test_unpause_guardianCannot() public {
        vm.prank(guardian);
        claim.pause();
        vm.prank(guardian);
        vm.expectRevert();
        claim.unpause();
    }

    function test_setGuardian() public {
        address g = makeAddr("g2");
        vm.prank(owner);
        claim.setGuardian(g);
        assertEq(claim.guardian(), g);
        vm.prank(owner);
        vm.expectRevert(InvoiceClaim.ZeroAddress.selector);
        claim.setGuardian(address(0));
        vm.prank(guardian);
        vm.expectRevert();
        claim.setGuardian(g);
        vm.prank(address(0));
        vm.expectRevert();
        claim.setGuardian(g);
    }

    function test_ownership_isTwoStep() public {
        address next = makeAddr("next");
        vm.prank(owner);
        claim.transferOwnership(next);
        assertEq(claim.owner(), owner);
        vm.prank(next);
        claim.acceptOwnership();
        assertEq(claim.owner(), next);
    }
}

contract Receiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
