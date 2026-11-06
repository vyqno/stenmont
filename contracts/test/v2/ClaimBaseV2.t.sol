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

/// @dev Setup and signing helpers shared by the InvoiceClaimV2 unit, fuzz and invariant tests.
abstract contract ClaimBaseV2 is BaseV2 {
    InvestorRegistry internal registry;
    InvoiceClaimV2 internal claim;

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
        claim = new InvoiceClaimV2(address(usdt), address(router), address(registry), owner, guardian);
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
        returns (IPaymentRouterV2.Auth memory a)
    {
        address from = vm.addr(pk);
        bytes32 nonce = claim.fundNonce(id, salt);
        bytes32 structHash = keccak256(
            abi.encode(usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, address(claim), value, 0, T0 + 1 days, nonce)
        );
        a = IPaymentRouterV2.Auth({
            payer: from,
            validAfter: 0,
            validBefore: T0 + 1 days,
            salt: salt,
            signature: _sig(pk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash)))
        });
    }

    function _fund(bytes32 id, uint256 pk, uint128 price) internal {
        IPaymentRouterV2.Auth memory a = _fundAuth(pk, id, price, keccak256("fund"));
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
}
