import { describe, expect, it } from "vitest";
import { buildTree, leafHash, proofFor, verifyProof } from "../src/merkle";

const H1 = `0x${"11".repeat(32)}` as const;
const H2 = `0x${"22".repeat(32)}` as const;
const H3 = `0x${"33".repeat(32)}` as const;
// Computed independently with `cast keccak "$(cast from-utf8 '<txHash>|<invoiceId>|<amount>|<kind>')"` and sorted-pair `cast keccak <a><b>`.
const A = { txHash: H1, invoiceId: H2, amount: 2500000n, kind: "payment" };
const B = { txHash: H3, invoiceId: H2, amount: 500000n, kind: "refund" };
const C = { txHash: H1, invoiceId: H3, amount: 1000000n, kind: "advance" };
const LA = "0x72947bb05d8a46e80e87adfcab79b84d4315c34f477aec9f70cdbf33975eb468";
const LB = "0xde0483723c09df55aae1e6da880c79811b0cdfae38db1a449ae0fd3c8ee5a3be";
const LC = "0x32f131c5b9ffae1a35c7d50e6020fc2984077ab14d34889c1d18b6c2d9af8d78";
const AB = "0x606863a971f48501868d3bab6e3984dd5197e10b2e17449f3c97d8061502c306";
const ROOT3 = "0x900ca9d78a55575d157c29ef7d9bf36019be2dac9db69f025622bee6245888ba";

describe("leafHash", () => {
  it("matches the independently computed keccak256 of txHash|invoiceId|amount|kind", () => {
    expect(leafHash(A)).toBe(LA);
    expect(leafHash(B)).toBe(LB);
    expect(leafHash(C)).toBe(LC);
  });
  it("is case-insensitive for hex and rejects bad input", () => {
    expect(leafHash({ ...A, txHash: H1.toUpperCase().replace("0X", "0x") as `0x${string}` })).toBe(LA);
    expect(() => leafHash({ ...A, kind: "a|b" })).toThrow();
    expect(() => leafHash({ ...A, amount: -1n })).toThrow();
    expect(() => leafHash({ ...A, txHash: "0x12" as `0x${string}` })).toThrow();
  });
});

describe("tree", () => {
  it("empty set has the zero root", () => {
    expect(buildTree([]).root).toBe(`0x${"00".repeat(32)}`);
  });
  it("one leaf is its own root, with an empty proof", () => {
    const t = buildTree([LA]);
    expect(t.root).toBe(LA);
    expect(proofFor(t, 0)).toEqual([]);
  });
  it("two leaves hash as a sorted pair, whatever the input order", () => {
    expect(buildTree([LA, LB]).root).toBe(AB);
    expect(buildTree([LB, LA]).root).toBe(AB);
  });
  it("three leaves: the odd node is promoted unchanged (not duplicated)", () => {
    const t = buildTree([LB, LA, LC]);
    expect(t.root).toBe(ROOT3);
    expect(t.leaves).toEqual([LC, LA, LB]); // sorted
  });
  it("every leaf of trees of 1..33 leaves verifies; a changed leaf or wrong root does not", () => {
    for (let n = 1; n <= 33; n++) {
      const leaves = Array.from({ length: n }, (_, i) => leafHash({ txHash: H1, invoiceId: H2, amount: BigInt(i + 1), kind: "payment" }));
      const t = buildTree(leaves);
      for (let i = 0; i < n; i++) {
        const p = proofFor(t, i);
        expect(verifyProof(t.leaves[i]!, p, t.root)).toBe(true);
        expect(verifyProof(leafHash({ txHash: H1, invoiceId: H2, amount: 999n, kind: "payment" }), p, t.root)).toBe(n === 1 ? false : false);
      }
      expect(verifyProof(t.leaves[0]!, proofFor(t, 0), LB)).toBe(false);
    }
  });
  it("a three-leaf proof is checked against the vector root", () => {
    const t = buildTree([LA, LB, LC]);
    expect(verifyProof(LB, proofFor(t, t.leaves.indexOf(LB)), ROOT3)).toBe(true);
    expect(proofFor(t, t.leaves.indexOf(LB))).toEqual(["0x6154de801d040b42fcd59cdb5d466a66e18f71f036256fd2cd25d19d96d22f3d"]);
  });
});
