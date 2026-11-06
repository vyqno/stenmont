// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {BaseV2} from "./BaseV2.t.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Finding L-2: a pause (for example after a creator key leak) also blocked the merchant from revoking that
///         creator, so the leaked key could create invoices the moment the router was unpaused. Revoking now works
///         while paused; granting still does not.
contract CreatorRevokeV2Test is BaseV2 {
    function _grant() internal {
        bytes memory sig = _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, router.creatorNonce(merchant));
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
    }

    function test_revokeWorksWhilePaused() public {
        _grant();
        vm.prank(guardian);
        router.pause();
        bytes memory sig = _creatorSig(merchantPk, merchant, relayer, false, T0 + 1 days, router.creatorNonce(merchant));
        router.setCreator(merchant, relayer, false, T0 + 1 days, sig);
        assertFalse(router.creators(merchant, relayer));
        vm.prank(owner);
        router.unpause();
        vm.prank(relayer);
        vm.expectRevert();
        router.createInvoiceAsCreator(_req("leak", AMOUNT));
    }

    function test_grantStillBlockedWhilePaused() public {
        vm.prank(guardian);
        router.pause();
        bytes memory sig = _creatorSig(merchantPk, merchant, relayer, true, T0 + 1 days, router.creatorNonce(merchant));
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.setCreator(merchant, relayer, true, T0 + 1 days, sig);
    }
}
