// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ReputationRegistryV2} from "../../src/ReputationRegistryV2.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";
import {BaseV2} from "./BaseV2.t.sol";
import {GarbageReputation, ReturnBombReputation} from "./FailureModesV2.t.sol";

/// @notice Finding L-1 (gas starvation) and I-1 (return-data bomb) on the optional reputation call.
contract ReputationGasV2Test is BaseV2 {
    function _wire(address rep) internal {
        vm.prank(owner);
        router.setReputation(rep);
    }

    /// @dev Whatever gas limit the submitter picks, a payment that succeeds has also been recorded: nobody can
    ///      starve the reputation call to deny the payer its on-time record.
    function test_gasStarvation_cannotSkipTheRecord() public {
        ReputationRegistryV2 rep = new ReputationRegistryV2(owner);
        vm.prank(owner);
        rep.setRecorder(address(router), true);
        _wire(address(rep));
        bytes32 id = _newInvoice("gas", AMOUNT);
        IPaymentRouterV2.Auth memory a = _payAuth(payerPk, id, AMOUNT, "s");
        bytes memory call_ = abi.encodeCall(router.pay, (id, AMOUNT, payout, a));
        uint256 okCount;
        for (uint256 g = 100_000; g < 360_000; g += 1000) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(router).call{gas: g}(call_);
            if (ok) {
                okCount++;
                assertEq(rep.paidCount(payer), 1, "paid but not recorded");
            }
            vm.revertToState(snap);
        }
        assertGt(okCount, 0);
    }

    /// @dev The registry's return data is never copied, so a return-data bomb costs the payer at most the registry's
    ///      own 100k gas budget (before the fix the router copied it too: about 167k extra).
    function test_returnBomb_extraCostBoundedByTheRegistryBudget() public {
        bytes32 id1 = _newInvoice("a", AMOUNT);
        bytes32 id2 = _newInvoice("b", AMOUNT);
        IPaymentRouterV2.Auth memory a1 = _payAuth(payerPk, id1, AMOUNT, "s1");
        IPaymentRouterV2.Auth memory a2 = _payAuth(payerPk, id2, AMOUNT, "s2");

        _wire(address(new GarbageReputation()));
        uint256 g0 = gasleft();
        router.pay(id1, AMOUNT, payout, a1);
        uint256 plain = g0 - gasleft();

        _wire(address(new ReturnBombReputation()));
        g0 = gasleft();
        router.pay(id2, AMOUNT, payout, a2);
        uint256 bombed = g0 - gasleft();

        assertLt(bombed, plain + 100_000, "return data was copied");
    }
}
