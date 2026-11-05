import { describe, expect, it } from "vitest";
import { invoiceId, invoiceRef, payNonce, refundNonce } from "../src/ids";

const merchant = "0x50c94c3021962047F10c9c58D80C4A7b73182a63";
const relayer = "0xe4F5853650f40f04e920c62F6dE9e4e38D767B66";

// Vectors computed independently with `cast keccak` and `cast abi-encode`. The same constants are asserted in
// contracts/test/PaymentRouter.t.sol (test_ids_matchSharedPackageVectors), so TypeScript and Solidity cannot drift.
const REF = "0x80066d42cb1d1876d3f91ddfce739f4649eb223e815f12756f733eb185548803";
const ID = "0x9ef5cc50eed76dda0d467227d32f719840fdc30d278ccee49088083624704f1b";
const SALT = "0xad7b6b88034155f1e86d31a54d7723ede2183a6538ecab39ce7a7144ff280fcd"; // keccak256("salt-1")
const PAY_NONCE = "0x30c0821dae3ef5dfd5e9a46e71ce92f134ddac0b8e6be8fa3745d8e8897c9a03";
const REFUND_NONCE = "0x626e030da4e60de0d17bf6c6205d7f6cc4cee8e853470b61bc2f9f2efd12cc93";

describe("ids (must match PaymentRouter)", () => {
  it("invoiceRef is keccak256 of the invoice number", () => {
    expect(invoiceRef("INV-1")).toBe(REF);
  });
  it("invoiceId matches PaymentRouter.invoiceIdOf", () => {
    expect(invoiceId(merchant, "INV-1")).toBe(ID);
  });
  it("is stable, merchant-scoped and 32 bytes", () => {
    expect(invoiceId(merchant, "INV-1")).toBe(invoiceId(merchant, "INV-1"));
    expect(invoiceId(merchant, "INV-1")).not.toBe(invoiceId(merchant, "INV-2"));
    expect(invoiceId(merchant, "INV-1")).not.toBe(invoiceId(relayer, "INV-1"));
    expect(invoiceId(merchant, "INV-1")).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("payNonce and refundNonce match the contract", () => {
    expect(payNonce(ID, SALT)).toBe(PAY_NONCE);
    expect(refundNonce(ID, relayer, SALT)).toBe(REFUND_NONCE);
  });
  it("nonces differ by kind, recipient and salt", () => {
    expect(payNonce(ID, SALT)).not.toBe(refundNonce(ID, relayer, SALT));
    expect(refundNonce(ID, relayer, SALT)).not.toBe(refundNonce(ID, merchant, SALT));
  });
});
