import { describe, expect, it } from "vitest";
import { createApproval, hashParams, markApproved, markDenied, memoryApprovalRepo, requireApproval, type Operation } from "../../src/world/approvals";

const T0 = new Date("2026-11-06T10:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
let n = 0;
const ids = { newId: () => `a${++n}`, newNonce: () => `nonce${n}` };
const refund = (amount: string, invoiceId = "0xinv") => ({ invoiceId, amount, to: "0xpayer" });

async function setup(params: object = refund("150000000"), op: Operation = "refund", merchantId = "m1") {
  const repo = memoryApprovalRepo();
  const a = await createApproval(repo, { merchantId, operation: op, params }, { now: T0, ...ids });
  return { repo, a, claims: (authAge = 10) => ({ sub: "world_sub", auth_time: secs(T0) - authAge, nonce: a.nonce }) };
}
const gate = (repo: any, params: object, now = at(60), op: Operation = "refund", merchantId = "m1") => requireApproval(repo, { merchantId, operation: op, params, now });

describe("hashParams", () => {
  it("is key-order independent, nested too, and sensitive to values", async () => {
    expect(await hashParams({ a: 1, b: { c: 2, d: 3 } })).toBe(await hashParams({ b: { d: 3, c: 2 }, a: 1 }));
    expect(await hashParams({ a: 1 })).not.toBe(await hashParams({ a: 2 }));
    expect(await hashParams({ a: 1, z: undefined })).toBe(await hashParams({ a: 1 }));
    expect(await hashParams({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("approval state machine", () => {
  it("no approval -> approval_required", async () => {
    expect(await gate(memoryApprovalRepo(), refund("1"))).toMatchObject({ ok: false, code: "approval_required" });
  });
  it("created with a 5 minute expiry and pending is not enough", async () => {
    const { repo, a } = await setup();
    expect(Date.parse(a.expiresAt) - Date.parse(a.createdAt)).toBe(300_000);
    expect(await gate(repo, refund("150000000"))).toMatchObject({ code: "approval_required" });
  });
  it("approved -> allowed once; reuse is refused", async () => {
    const { repo, a, claims } = await setup();
    expect(await markApproved(repo, a.id, claims(), at(30))).toEqual({ ok: true });
    expect(await gate(repo, refund("150000000"))).toMatchObject({ ok: true, approvalId: a.id, worldSub: "world_sub" });
    expect(await gate(repo, refund("150000000"))).toMatchObject({ ok: false, code: "approval_required" });
  });
  it("concurrent use: exactly one wins", async () => {
    const { repo, a, claims } = await setup();
    await markApproved(repo, a.id, claims(), at(30));
    const r = await Promise.all([1, 2, 3, 4, 5].map(() => gate(repo, refund("150000000"))));
    expect(r.filter((x) => x.ok)).toHaveLength(1);
  });
  it("approval for refund A does not authorise refund B (amount, invoice, key order irrelevant)", async () => {
    const { repo, a, claims } = await setup(refund("150000000", "0xA"));
    await markApproved(repo, a.id, claims(), at(30));
    expect(await gate(repo, refund("150000001", "0xA"))).toMatchObject({ ok: false, code: "approval_mismatch" });
    expect(await gate(repo, refund("150000000", "0xB"))).toMatchObject({ ok: false, code: "approval_mismatch" });
    expect(await gate(repo, { to: "0xpayer", amount: "150000000", invoiceId: "0xA" })).toMatchObject({ ok: true });
  });
  it("approval is bound to merchant and operation", async () => {
    const { repo, a, claims } = await setup();
    await markApproved(repo, a.id, claims(), at(30));
    expect(await gate(repo, refund("150000000"), at(60), "refund", "m2")).toMatchObject({ code: "approval_required" });
    expect(await gate(repo, refund("150000000"), at(60), "payout_change")).toMatchObject({ code: "approval_required" });
    expect(await gate(repo, refund("150000000"))).toMatchObject({ ok: true });
  });
  it("denied / cancelled: the action is refused and the reason is kept", async () => {
    const { repo, a } = await setup();
    expect(await markDenied(repo, a.id, "user_cancelled")).toEqual({ ok: true });
    expect(await gate(repo, refund("150000000"))).toEqual({ ok: false, code: "approval_denied", message: "user_cancelled" });
    expect(repo.rows[0]!.status).toBe("denied");
  });
  it("a denied approval cannot later be approved by a late callback", async () => {
    const { repo, a, claims } = await setup();
    await markDenied(repo, a.id, "access_denied");
    expect(await markApproved(repo, a.id, claims(), at(30))).toMatchObject({ ok: false, code: "not_pending" });
    expect(await gate(repo, refund("150000000"))).toMatchObject({ code: "approval_denied" });
  });
  it("never completed and past 5 minutes -> approval_expired; cannot be approved late", async () => {
    const { repo, a, claims } = await setup();
    expect(await gate(repo, refund("150000000"), at(301))).toMatchObject({ code: "approval_expired" });
    expect(await markApproved(repo, a.id, claims(), at(301))).toMatchObject({ ok: false, code: "approval_expired" });
  });
  it("approved but used after the 5 minutes -> approval_expired", async () => {
    const { repo, a, claims } = await setup();
    await markApproved(repo, a.id, claims(), at(30));
    expect(await gate(repo, refund("150000000"), at(300))).toMatchObject({ code: "approval_expired" });
    expect(repo.rows[0]!.status).toBe("approved"); // not consumed
  });
  it("auth_time older than 5 minutes is refused at approval time", async () => {
    const { repo, a, claims } = await setup();
    expect(await markApproved(repo, a.id, claims(301), at(30))).toMatchObject({ ok: false, code: "stale_auth" });
    expect(repo.rows[0]!.status).toBe("pending");
  });
  it("auth_time is re-checked at consumption (approval row with a stale auth_time)", async () => {
    const { repo, a, claims } = await setup();
    await markApproved(repo, a.id, claims(250), at(30));
    expect(await gate(repo, refund("150000000"), at(100))).toMatchObject({ code: "approval_expired" });
  });
  it("wrong nonce is refused", async () => {
    const { repo, a, claims } = await setup();
    expect(await markApproved(repo, a.id, { ...claims(), nonce: "x" }, at(30))).toMatchObject({ ok: false, code: "nonce_mismatch" });
  });
  it("unknown id and double approval", async () => {
    const { repo, a, claims } = await setup();
    expect(await markApproved(repo, "nope", claims(), at(1))).toMatchObject({ code: "not_found" });
    await markApproved(repo, a.id, claims(), at(1));
    expect(await markApproved(repo, a.id, claims(), at(2))).toMatchObject({ code: "not_pending" });
  });
  it("a fresh approval after a denial works; denial of the old one does not block", async () => {
    const { repo, a } = await setup();
    await markDenied(repo, a.id, "cancelled");
    const b = await createApproval(repo, { merchantId: "m1", operation: "refund", params: refund("150000000") }, { now: T0, ...ids });
    await markApproved(repo, b.id, { sub: "s", auth_time: secs(T0), nonce: b.nonce }, at(5));
    expect(await gate(repo, refund("150000000"))).toMatchObject({ ok: true, approvalId: b.id });
  });
  it("protected action stays undone unless ok:true (caller pattern)", async () => {
    const { repo, a } = await setup();
    await markDenied(repo, a.id, "cancelled");
    let refunded = false;
    const g = await gate(repo, refund("150000000"));
    if (g.ok) refunded = true;
    expect(refunded).toBe(false);
  });
});
