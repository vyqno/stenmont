// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../../src/InvestorRegistry.sol";
import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {BaseV2} from "./BaseV2.t.sol";
import {MockHook} from "../mocks/MockHook.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";
contract ClaimV2Regression2Test is ClaimBaseV2 {
    bytes32 internal constant REF = keccak256("INV-1");
    function _claimStatus(bytes32 id) internal view returns(InvoiceClaimV2.ClaimStatus) { return claim.claims(id).status; }
    function test_fund_afterFundBy_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.warp(T0 + 1 days + 1);
        vm.expectRevert(InvoiceClaimV2.Expired.selector);
        claim.fund(id, a);
    }
    function test_fund_neverAllowlisted_reverts() public {
        bytes32 id = _listed(REF);
        uint256 strangerPk = 0x57A9;
        usdt.mint(vm.addr(strangerPk), PRICE);
        IPaymentRouterV2.Auth memory a = _fundAuth(strangerPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaimV2.NotAllowlisted.selector);
        claim.fund(id, a);
    }
    function test_fund_revokedInvestor_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.prank(owner);
        registry.revoke(investor);
        vm.expectRevert(InvoiceClaimV2.NotAllowlisted.selector);
        claim.fund(id, a);
    }
    function test_fund_blockedInvestor_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.prank(owner);
        registry.setBlocked(investor, true);
        vm.expectRevert(InvoiceClaimV2.NotAllowlisted.selector);
        claim.fund(id, a);
    }
    function test_fund_invoiceCancelledAfterListing_reverts() public {
        bytes32 id = _listed(REF);
        claim.cancelListing(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Cancelled));
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Cancelled));
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaimV2.NotListed.selector);
        claim.fund(id, a);
    }
    function test_routerCancel_onListedInvoice_revertsInvoiceSold() public {
        bytes32 id = _listed(REF);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.InvoiceSold.selector);
        router.cancel(id, T0 + 1 days, sig);
    }
    function test_cancelListing_afterFunding_reverts_investorProtected() public {
        bytes32 id = _funded(REF);
        bytes memory sig = _cancelSig(merchantPk, id, T0 + 1 days);
        vm.expectRevert(InvoiceClaimV2.NotListed.selector);
        claim.cancelListing(id, T0 + 1 days, sig);
        vm.expectRevert(IPaymentRouterV2.InvoiceSold.selector);
        router.cancel(id, T0 + 1 days, sig);
        assertEq(uint8(router.invoices(id).status), uint8(IPaymentRouterV2.Status.Open));
    }
    function test_cancelListing_needsMerchantSignature_andAListedClaim() public {
        bytes32 id = _listed(REF);
        bytes memory wrong = _cancelSig(payerPk, id, T0 + 1 days);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        claim.cancelListing(id, T0 + 1 days, wrong);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Listed)); // the revert rolled everything back
        vm.expectRevert(InvoiceClaimV2.NotListed.selector);
        claim.cancelListing(keccak256("unknown"), T0 + 1 days, "");
    }
    function test_fund_wrongSigner_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouterV2.Auth memory a = _fundAuth(investor2Pk, id, PRICE, keccak256("fund"));
        a.payer = investor; // claim to be investor but signed by investor2
        vm.expectRevert();
        claim.fund(id, a);
    }
    function test_fund_authorizationForOtherInvoiceCannotBeRedirected() public {
        bytes32 a1 = _listed(keccak256("A"));
        bytes32 b1 = _listed(keccak256("B"));
        IPaymentRouterV2.Auth memory authA = _fundAuth(investorPk, a1, PRICE, keccak256("fund"));
        vm.expectRevert();
        claim.fund(b1, authA);
        assertEq(usdt.balanceOf(address(claim)), 0);
    }
    function test_fund_paused_reverts() public {
        bytes32 id = _listed(REF);
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
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
        IPaymentRouterV2.Auth memory a = _fundAuth(0x5A17, id, PRICE, keccak256("fund"));
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
    function test_payerPays_routesToInvestor_andReleasesReserve() public {
        bytes32 id = _funded(REF);
        uint256 inv0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);

        _pay(id, AMOUNT, payerPk, keccak256("p1"));

        assertEq(usdt.balanceOf(investor), inv0 + AMOUNT, "holder gets the face");
        assertEq(usdt.balanceOf(payout), pay0 + RESERVE_AMT, "merchant gets the reserve back");
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Settled));
        assertEq(claim.claims(id).received, AMOUNT);
    }
    function test_partialPayments_goToHolder_thenSettle() public {
        bytes32 id = _funded(REF);
        uint256 inv0 = usdt.balanceOf(investor);
        _pay(id, 40e6, payerPk, keccak256("p1"));
        assertEq(usdt.balanceOf(investor), inv0 + 40e6);
        assertEq(usdt.balanceOf(address(claim)), RESERVE_AMT);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Funded));
        _pay(id, 60e6, payer2Pk, keccak256("p2"));
        assertEq(usdt.balanceOf(investor), inv0 + AMOUNT);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Settled));
    }
    function test_payingWhileListed_goesToMerchant_andVoidsTheListing() public {
        bytes32 id = _listed(REF);
        uint256 pay0 = usdt.balanceOf(payout);
        _pay(id, 30e6, payerPk, keccak256("p1"));
        assertEq(usdt.balanceOf(payout), pay0 + 30e6);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Cancelled));

        // an investor can no longer fund it
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaimV2.NotListed.selector);
        claim.fund(id, a);

        // later payments still reach the merchant
        _pay(id, 70e6, payer2Pk, keccak256("p2"));
        assertEq(usdt.balanceOf(payout), pay0 + 100e6);
        assertEq(usdt.balanceOf(address(claim)), 0);
    }
    function test_onPaid_notRouter_reverts() public {
        bytes32 id = _funded(REF);
        vm.expectRevert(InvoiceClaimV2.NotRouter.selector);
        claim.onPaid(id, 1);
        vm.prank(merchant);
        vm.expectRevert(InvoiceClaimV2.NotRouter.selector);
        claim.onPaid(id, 1);
        vm.prank(address(claim));
        vm.expectRevert(InvoiceClaimV2.NotRouter.selector);
        claim.onPaid(id, 1);
    }
    function test_onPaid_unknownClaim_reverts_soTheRouterRevertsToo() public {
        // a merchant who signed SetHook to the claim contract without listing: payments must not strand money
        bytes32 id = _newInvoice(REF, AMOUNT);
        router.setHook(id, address(claim), T0 + 1 days, _hookSig(merchantPk, id, address(claim), T0 + 1 days));
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, 10e6, keccak256("s"));
        vm.expectRevert(InvoiceClaimV2.NotListed.selector);
        router.pay(id, 10e6, payout, a);
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
        emit InvoiceClaimV2.PayoutDeferred(investor, AMOUNT);
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
    function test_markDefault_beforeGrace_reverts() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 30 days + 7 days); // exactly the end of grace: still not allowed
        vm.expectRevert(InvoiceClaimV2.GraceNotOver.selector);
        claim.markDefault(id);
    }
    function test_markDefault_afterGrace_reserveToInvestor() public {
        bytes32 id = _funded(REF);
        uint256 i0 = usdt.balanceOf(investor);
        vm.warp(T0 + 30 days + 7 days + 1);
        vm.expectEmit(true, true, false, true, address(claim));
        emit InvoiceClaimV2.ClaimDefaulted(id, investor, RESERVE_AMT);
        vm.prank(makeAddr("anyone"));
        claim.markDefault(id);
        assertEq(usdt.balanceOf(investor), i0 + RESERVE_AMT);
        assertEq(usdt.balanceOf(address(claim)), 0);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Defaulted));
        assertEq(claim.claims(id).toHolder, RESERVE_AMT);
    }
    function test_markDefault_twice_reverts_reserveNeverPaidTwice() public {
        bytes32 id = _funded(REF);
        vm.warp(T0 + 40 days);
        claim.markDefault(id);
        vm.expectRevert(InvoiceClaimV2.NotFunded.selector);
        claim.markDefault(id);
    }
}
