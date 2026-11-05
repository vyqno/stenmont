// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Test} from "forge-std/Test.sol";

/// @dev The vector used by scripts/spikes/p256.ts, checked against OpenZeppelin's Solidity implementation.
///      On the real chain the precompile at 0x100 answers the same vector (spike 0.2).
contract P256Test is Test {
    bytes internal constant VECTOR =
        hex"8da82ccdaee87a02fe304d4c1ebe28852373c5678296fce464cdc889e1dd23871efb4a0714db102545f739eba83d70f113ec2eb59035c736dfedfcb4d04ecbb12d40c4154adeb15a1835a3b7d8b1655cd8e21c9161000d4d775a891acfb753c67268876e19db7d7a651d55d5f3cd08b0f14f0f2d99ac383d56e705cc58b2de09272f3460d10844d9d8a77c0f6f5754c8e1c7fa3a58c6671f9199d8710af43878";

    function _verify(bytes memory v) internal view returns (bool) {
        bytes32 h;
        bytes32 r;
        bytes32 s;
        bytes32 x;
        bytes32 y;
        assembly {
            h := mload(add(v, 0x20))
            r := mload(add(v, 0x40))
            s := mload(add(v, 0x60))
            x := mload(add(v, 0x80))
            y := mload(add(v, 0xa0))
        }
        return P256.verify(h, r, s, x, y);
    }

    function test_fallback_acceptsTheVector() public view {
        assertTrue(_verify(VECTOR));
    }

    function test_fallback_rejectsATamperedMessage() public view {
        bytes memory v = VECTOR;
        v[0] = bytes1(uint8(v[0]) ^ 0x01);
        assertFalse(_verify(v));
    }
}
