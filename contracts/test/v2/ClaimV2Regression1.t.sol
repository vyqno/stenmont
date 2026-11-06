// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {InvestorRegistry} from "../../src/InvestorRegistry.sol";
import {InvoiceClaimV2} from "../../src/InvoiceClaimV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {MockHook} from "../mocks/MockHook.sol";
import {MockWallet} from "../mocks/MockWallet.sol";
import {BaseV2} from "./BaseV2.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import {ClaimBaseV2} from "./ClaimBaseV2.t.sol";

contract ClaimV2Regression1Test is ClaimBaseV2 {
    bytes32 internal constant REF = keccak256("INV-1");

    function _claimStatus(bytes32 id) internal view returns (InvoiceClaimV2.ClaimStatus) {
        return claim.claims(id).status;
    }

    function test_constructor_zeroAddresses_revert() public {
        address a = address(1);
        vm.expectRevert(InvoiceClaimV2.ZeroAddress.selector);
        new InvoiceClaimV2(address(0), a, a, a, a);
        vm.expectRevert(InvoiceClaimV2.ZeroAddress.selector);
        new InvoiceClaimV2(a, address(0), a, a, a);
        vm.expectRevert(InvoiceClaimV2.ZeroAddress.selector);
        new InvoiceClaimV2(a, a, address(0), a, a);
        vm.expectRevert(InvoiceClaimV2.ZeroAddress.selector);
        new InvoiceClaimV2(a, a, a, a, address(0));
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
        vm.expectRevert(InvoiceClaimV2.BadTerms.selector);
        claim.quote(100e6, 10_000, 0); // 100% discount
        vm.expectRevert(InvoiceClaimV2.BadTerms.selector);
        claim.quote(100e6, 9000, 1001); // reserve above price
    }

    function test_list_setsHookAndClaim() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        vm.expectEmit(true, true, false, true, address(claim));
        emit InvoiceClaimV2.ClaimListed(id, merchant, AMOUNT, PRICE, RESERVE_AMT, uint64(T0 + 30 days));
        _list(id, DISCOUNT, RESERVE);

        assertEq(router.invoices(id).hook, address(claim));
        InvoiceClaimV2.Claim memory c = claim.claims(id);
        assertEq(c.payee, payout);
        assertEq(c.face, AMOUNT);
        assertEq(c.price, PRICE);
        assertEq(c.reserve, RESERVE_AMT);
        assertEq(c.dueDate, uint64(T0 + 30 days));
        assertEq(c.fundBy, uint64(T0 + 1 days));
        assertEq(uint8(c.status), uint8(InvoiceClaimV2.ClaimStatus.Listed));
    }

    function test_list_fundByIsCappedAtDueDate() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(keccak256("short"), AMOUNT);
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
        vm.expectRevert(InvoiceClaimV2.Expired.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_twice_reverts_AlreadyListed() public {
        bytes32 id = _listed(REF);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.AlreadyListed.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_unknownInvoice_reverts() public {
        bytes32 id = keccak256("nope");
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_partlyPaidInvoice_reverts() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF, AMOUNT);
        bytes32 id = _create(r);
        _pay(id, 10e6, payerPk, keccak256("s"));
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_cancelledInvoice_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        router.cancel(id, T0 + 1 days, _cancelSig(merchantPk, id, T0 + 1 days));
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_invoiceWithOtherHook_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        MockHook other = new MockHook();
        bytes memory hookSig_ = _hookSig(merchantPk, id, address(other), T0 + 1 days);
        vm.prank(address(other));
        router.setHook(id, address(other), T0 + 1 days, hookSig_);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_noDueDate_reverts() public {
        IPaymentRouterV2.CreateInvoice memory r = _req(REF, AMOUNT);
        r.dueDate = 0;
        bytes32 id = _create(r);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_pastDueDate_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 40 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.warp(T0 + 31 days);
        vm.expectRevert(InvoiceClaimV2.InvoiceNotSellable.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_termsSignedBySomeoneElse_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(payerPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.BadSignature.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
    }

    function test_list_termsTamperedByRelayer_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.BadSignature.selector);
        claim.list(id, 9000, RESERVE, deadline, ts, hs); // a deeper discount than the merchant signed
    }

    function test_list_badHookSignature_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, DISCOUNT, RESERVE, deadline);
        bytes memory hs = _hookSig(payerPk, id, address(claim), deadline);
        vm.expectRevert(IPaymentRouterV2.BadSignature.selector);
        claim.list(id, DISCOUNT, RESERVE, deadline, ts, hs);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.None)); // all or nothing
    }

    function test_list_badBps_reverts() public {
        bytes32 id = _newInvoice(REF, AMOUNT);
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, 10_000, 0, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.BadTerms.selector);
        claim.list(id, 10_000, 0, deadline, ts, hs);
    }

    function test_list_zeroPrice_reverts() public {
        bytes32 id = _newInvoice(REF, 1); // face 1 base unit at 50% discount rounds to a price of 0
        uint256 deadline = T0 + 1 days;
        bytes memory ts = _termsSig(merchantPk, id, 5000, 0, deadline);
        bytes memory hs = _hookSig(merchantPk, id, address(claim), deadline);
        vm.expectRevert(InvoiceClaimV2.ZeroAmount.selector);
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
        IPaymentRouterV2.CreateInvoice memory r = _req(REF, AMOUNT);
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

    function test_fund_paysMerchantPriceMinusReserve_andMints() public {
        bytes32 id = _listed(REF);
        uint256 inv0 = usdt.balanceOf(investor);
        uint256 pay0 = usdt.balanceOf(payout);

        vm.expectEmit(true, true, false, true, address(claim));
        emit InvoiceClaimV2.ClaimFunded(id, investor, PRICE, ADVANCE);
        _fund(id, investorPk, PRICE);

        assertEq(usdt.balanceOf(investor), inv0 - PRICE);
        assertEq(usdt.balanceOf(payout), pay0 + ADVANCE);
        assertEq(usdt.balanceOf(address(claim)), RESERVE_AMT);
        assertEq(claim.ownerOf(uint256(id)), investor);
        assertEq(uint8(_claimStatus(id)), uint8(InvoiceClaimV2.ClaimStatus.Funded));
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
        IPaymentRouterV2.Auth memory a = _fundAuth(investorPk, id, PRICE, keccak256("fund"));
        vm.expectRevert(InvoiceClaimV2.NotListed.selector);
        claim.fund(id, a);
    }

    function test_fund_twice_reverts() public {
        bytes32 id = _funded(REF);
        IPaymentRouterV2.Auth memory a = _fundAuth(investor2Pk, id, PRICE, keccak256("again"));
        vm.expectRevert(InvoiceClaimV2.NotListed.selector);
        claim.fund(id, a);
    }
}
