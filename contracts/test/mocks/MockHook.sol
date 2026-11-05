// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {IClaimPayout} from "../../src/interfaces/IClaimPayout.sol";
import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";

contract MockHook is IClaimPayout {
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
contract ReentrantHook is MockHook {
    IPaymentRouter public immutable router;
    IPaymentRouter.Auth internal auth;

    constructor(IPaymentRouter router_) {
        router = router_;
    }

    function arm(IPaymentRouter.Auth calldata a) external {
        auth = a;
    }

    function onPaid(bytes32 invoiceId, uint128 value) external override {
        router.pay(invoiceId, value, auth);
    }
}
