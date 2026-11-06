import { describe, expect, it } from "vitest";
import { invoiceTerms, creatorDelegationDigest } from "../lib/v2Invoice";
const buyer = "0x4444444444444444444444444444444444444444";
describe("named buyer invoice terms", () => {
  it("requires a named buyer for discount terms and rejects missing or past expiry", () => {
    expect(() => invoiceTerms("", "2", "2030-01-01T12:00", 1000)).toThrow();
    expect(() => invoiceTerms(buyer, "2", "", 1000)).toThrow();
    expect(() => invoiceTerms(buyer, "2", "2000-01-01T12:00", 1000_000_000_000)).toThrow();
    expect(invoiceTerms(buyer, "2", "2030-01-01T12:00", 1000)).toMatchObject({ buyerAddress: buyer, discountBps: 200 });
    expect(invoiceTerms("", "", "", 1000)).toEqual({});
  });
  it("never treats a v1 grant or changed router as a v2 delegation", () => {
    const a = { routerAddress: buyer as `0x${string}`, merchant: buyer as `0x${string}`, creator: "0x5555555555555555555555555555555555555555" as const, nonce: "1", deadline: 2000 };
    expect(creatorDelegationDigest(a)).not.toBe(creatorDelegationDigest({ ...a, routerAddress: a.creator }));
    expect(creatorDelegationDigest(a)).not.toBe(creatorDelegationDigest({ ...a, nonce: "2" }));
  });
});

it("binds acceptance to the stored buyer, invoice amount and due date", async () => {
  const { acknowledgementDigest } = await import("../lib/v2Invoice");
  const a = { invoiceId: `0x${"11".repeat(32)}` as const, ackAddress: buyer as `0x${string}`, buyer: buyer as `0x${string}`, amount: "1.00", dueDate: "2030-01-01T00:00:00.000Z", nonce: "0", deadline: 2000000000 };
  expect(acknowledgementDigest(a)).not.toBe(acknowledgementDigest({ ...a, amount: "2" }));
  expect(acknowledgementDigest(a)).not.toBe(acknowledgementDigest({ ...a, buyer: "0x5555555555555555555555555555555555555555" }));
});

 it("caps buyer discounts at the API’s 30 percent limit", () => {
   expect(invoiceTerms(buyer, "30", "2030-01-01T12:00", 1000)).toMatchObject({ discountBps: 3000 });
   expect(() => invoiceTerms(buyer, "30.01", "2030-01-01T12:00", 1000)).toThrow();
 });
 it("preserves numeric API deadlines from a response into the signed submission", async () => {
   const { challengeDeadline } = await import("../lib/v2Invoice");
   const response = JSON.parse('{"deadline":2000000000}');
   const post = JSON.parse(JSON.stringify({ buyer, deadline: challengeDeadline(response.deadline), signature: "0x12" }));
   expect(post.deadline).toBe(2000000000);
   expect(typeof post.deadline).toBe("number");
   expect(() => challengeDeadline("2000000000")).toThrow();
 });

it("targets World approval to the claim version instead of a changing creation default", async () => {
  const { investorApprovalTarget } = await import("../lib/investor");
  expect(investorApprovalTarget({ contractVersion: "v2" })).toBe("v2");
  expect(investorApprovalTarget({ contractVersion: "v1" })).toBe("v1");
  expect(investorApprovalTarget({})).toBe("v1");
  expect(() => investorApprovalTarget({ contractVersion: "v3" })).toThrow();
});
