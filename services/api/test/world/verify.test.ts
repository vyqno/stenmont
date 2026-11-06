import { describe, expect, it } from "vitest";
import { assertDifferentHumans, sameHuman } from "../../src/world/samehuman";
import { enrol, verifyProof } from "../../src/world/verify";
import { memoryWorldRepo } from "./helpers";

const proof = { action: "enrol-business", protocol_version: "4.0", nonce: "0x1", responses: [{ identifier: "proof_of_human" }] };
const reply = (status: number, body: unknown) => () => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
const ok = { success: true, action: "enrol-business", nullifier: "0xABC123", results: [{ identifier: "proof_of_human", success: true, nullifier: "0xABC123" }] };
const mk = (f: any) => ({ fetch: f as typeof fetch, baseUrl: "https://world.test/", rpId: "rp_1" });
const eDeps = (f: any, n = 0) => ({ ...mk(f), now: () => new Date("2026-11-06T10:00:00Z"), newId: () => `e${++n}` });

describe("verifyProof", () => {
  it("posts the proof unchanged to /api/v4/verify/{rp_id} and returns a normalised nullifier", async () => {
    let seen: any;
    const f = async (url: string, init: RequestInit) => ((seen = { url, body: init.body }), new Response(JSON.stringify(ok)));
    const r = await verifyProof(mk(f), proof, "enrol-business");
    expect(r).toMatchObject({ ok: true, nullifier: BigInt("0xabc123").toString() });
    expect(seen.url).toBe("https://world.test/api/v4/verify/rp_1");
    expect(seen.body).toBe(JSON.stringify(proof));
  });
  it("a 4xx rejection is invalid_proof with World's code", async () => {
    expect(await verifyProof(mk(reply(400, { code: "invalid_proof", detail: "bad" })), proof, "enrol-business")).toMatchObject({ ok: false, kind: "invalid_proof", code: "invalid_proof" });
  });
  it.each([
    ["5xx", reply(503, { code: "x" })],
    ["429", reply(429, {})],
    ["network error", () => Promise.reject(new Error("down"))],
    ["unreadable body", reply(200, "<html>")],
    ["success without nullifier", reply(200, { success: true })],
    ["garbage nullifier", reply(200, { success: true, nullifier: "<script>" })],
  ])("%s is upstream_error", async (_n, f) => {
    expect(await verifyProof(mk(f), proof, "enrol-business")).toMatchObject({ ok: false, kind: "upstream_error" });
  });
  it("never trusts a 200 that is not success:true, or a failed credential inside results", async () => {
    expect(await verifyProof(mk(reply(200, { success: false })), proof, "enrol-business")).toMatchObject({ ok: false, kind: "invalid_proof" });
    expect(await verifyProof(mk(reply(200, { ...ok, results: [{ success: false }] })), proof, "enrol-business")).toMatchObject({ ok: false, kind: "invalid_proof" });
  });
  it("rejects a proof made for another action without calling World", async () => {
    let called = false;
    const f = async () => ((called = true), new Response(JSON.stringify(ok)));
    expect(await verifyProof(mk(f), { ...proof, action: "other" }, "enrol-business")).toMatchObject({ ok: false, code: "action_mismatch" });
    expect(called).toBe(false);
    expect(await verifyProof(mk(f), null, "enrol-business")).toMatchObject({ ok: false, code: "malformed" });
  });
});

describe("enrol", () => {
  it("enrols on success", async () => {
    const repo = memoryWorldRepo();
    const r = await enrol(repo, eDeps(reply(200, ok)), { merchantId: "m1", action: "enrol-business", proof });
    expect(r).toMatchObject({ ok: true, enrollment: { merchantId: "m1", nullifier: BigInt("0xabc123").toString(), verifiedAt: "2026-11-06T10:00:00.000Z" } });
    expect(repo.rows).toHaveLength(1);
  });
  it("replay of the same nullifier by another business is a duplicate (409)", async () => {
    const repo = memoryWorldRepo();
    await enrol(repo, eDeps(reply(200, ok)), { merchantId: "m1", action: "enrol-business", proof });
    expect(await enrol(repo, eDeps(reply(200, ok)), { merchantId: "m2", action: "enrol-business", proof })).toMatchObject({ ok: false, kind: "duplicate" });
    expect(repo.rows).toHaveLength(1);
  });
  it("the same nullifier under another action is a different person-action pair and is allowed", async () => {
    const repo = memoryWorldRepo();
    await enrol(repo, eDeps(reply(200, ok)), { merchantId: "m1", action: "enrol-business", proof });
    const r = await enrol(repo, eDeps(reply(200, { ...ok, action: "approve" })), { merchantId: "m2", action: "approve", proof: { ...proof, action: "approve" } });
    expect(r.ok).toBe(true);
  });
  it("a business cannot enrol twice, and World is not even called", async () => {
    const repo = memoryWorldRepo();
    await enrol(repo, eDeps(reply(200, ok)), { merchantId: "m1", action: "enrol-business", proof });
    let called = false;
    const f = async () => ((called = true), new Response(JSON.stringify({ ...ok, nullifier: "0x999" })));
    expect(await enrol(repo, eDeps(f), { merchantId: "m1", action: "enrol-business", proof })).toMatchObject({ ok: false, kind: "already_enrolled" });
    expect(called).toBe(false);
  });
  it("upstream failure and rejected proof store nothing", async () => {
    const repo = memoryWorldRepo();
    expect(await enrol(repo, eDeps(reply(502, {})), { merchantId: "m1", action: "enrol-business", proof })).toMatchObject({ kind: "upstream_error" });
    expect(await enrol(repo, eDeps(reply(400, { code: "invalid_proof" })), { merchantId: "m1", action: "enrol-business", proof })).toMatchObject({ kind: "invalid_proof" });
    expect(repo.rows).toHaveLength(0);
  });
});

describe("same human", () => {
  it("pure check, case-insensitive", () => {
    expect(sameHuman(["0xAA"], ["0xaa", "0xbb"])).toBe(true);
    expect(sameHuman(["0x01"], ["0x02"])).toBe(false);
    expect(sameHuman([], [])).toBe(false);
  });
  it("rejects two merchants sharing a human, passes different humans, ignores other actions", async () => {
    const repo = memoryWorldRepo();
    const row = (id: string, m: string, n: string, action = "enrol-business") => repo.insertEnrollment({ id, merchantId: m, action, nullifier: n, verifiedAt: "t" });
    await row("1", "buyer", "0x1");
    await row("2", "supplier", "0x2");
    expect(await assertDifferentHumans(repo, "buyer", "supplier")).toEqual({ ok: true });
    // the same human enrolled a second business: that needs the same nullifier, which enrol() forbids; simulate a legacy row
    repo.rows.push({ id: "3", merchantId: "supplier", action: "enrol-business", nullifier: "0x1", verifiedAt: "t" });
    expect(await assertDifferentHumans(repo, "buyer", "supplier")).toEqual({ ok: false, code: "same_human" });
    repo.rows.splice(0, repo.rows.length, { id: "9", merchantId: "buyer", action: "other", nullifier: "0x1", verifiedAt: "t" }, { id: "8", merchantId: "supplier", action: "enrol-business", nullifier: "0x1", verifiedAt: "t" });
    expect(await assertDifferentHumans(repo, "buyer", "supplier")).toEqual({ ok: true });
  });
  it("a business paying itself is the same human", async () => {
    const repo = memoryWorldRepo();
    await repo.insertEnrollment({ id: "1", merchantId: "m", action: "enrol-business", nullifier: "0x1", verifiedAt: "t" });
    expect(await assertDifferentHumans(repo, "m", "m")).toEqual({ ok: false, code: "same_human" });
  });
});


describe("environment and number handling (World's integration guide, steps 5 and 6)", () => {
  const withEnv = (f: any, environment = "staging") => ({ ...mk(f), environment });
  it("refuses a proof made for another environment before calling World, and sends the expected one", async () => {
    let called = false;
    const f = async () => ((called = true), new Response(JSON.stringify({ ...ok, environment: "staging" })));
    const wrong = await verifyProof(withEnv(f, "production"), { action: "enrol-business", environment: "staging" }, "enrol-business");
    expect(wrong).toMatchObject({ ok: false, kind: "invalid_proof", code: "wrong_environment" });
    expect(called).toBe(false);
    const fine = await verifyProof(withEnv(f, "staging"), { action: "enrol-business", environment: "staging" }, "enrol-business");
    expect(fine.ok).toBe(true);
  });
  it("refuses an answer whose environment is not the expected one", async () => {
    const f = async () => new Response(JSON.stringify({ ...ok, environment: "production" }));
    expect(await verifyProof(withEnv(f, "staging"), { action: "enrol-business", environment: "staging" }, "enrol-business")).toMatchObject({ ok: false, code: "wrong_environment" });
  });
  it("treats the same number written two ways as the same person", async () => {
    const a = async () => new Response(JSON.stringify({ success: true, nullifier: "0x0abc" }));
    const b = async () => new Response(JSON.stringify({ success: true, nullifier: "0xABC" }));
    const ra = await verifyProof(mk(a), {}, "enrol-business");
    const rb = await verifyProof(mk(b), {}, "enrol-business");
    expect(ra.ok && rb.ok && ra.nullifier === rb.nullifier).toBe(true);
  });
});
