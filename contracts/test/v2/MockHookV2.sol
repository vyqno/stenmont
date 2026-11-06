// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IClaimPayout} from "../../src/interfaces/IClaimPayout.sol";
import {IPaymentRouterV2} from "../../src/interfaces/IPaymentRouterV2.sol";

contract MockHookV2 is IClaimPayout {
    bytes32 public lastId;
    uint128 public totalReceived;
    uint256 public calls;
    bool public shouldRevert;

    function setShouldRevert(bool v) external {
        shouldRevert = v;
    }

    function onPaid(bytes32 invoiceId, uint128 value) external virtual {
        require(!shouldRevert, "hook reverts");
        lastId = invoiceId;
        totalReceived += value;
        calls++;
    }
}

/// @notice Tries to call back into the router while it is mid-payment.
contract ReentrantHookV2 is MockHookV2 {
    IPaymentRouterV2 public immutable router;
    IPaymentRouterV2.Auth internal auth;

    constructor(IPaymentRouterV2 router_) {
        router = router_;
    }

    function arm(IPaymentRouterV2.Auth calldata a) external {
        auth = a;
    }

    function onPaid(bytes32 invoiceId, uint128 value) external override {
        router.pay(invoiceId, value, router.invoices(invoiceId).payout, auth);
    }
}
