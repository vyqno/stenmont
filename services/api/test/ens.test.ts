import { describe, expect, it } from "vitest";
import { ensNames } from "../src/db/schema";
import { dbOf } from "./helpers/fixtures";
import { MERCHANT_ADDRESS, seedMerchant, setup } from "./helpers/app";
import { AGENT_REGISTRY, RESOLVER } from "./helpers/ens";

const json = async (r: Response) => (await r.json()) as Record<string, any>;
type T = ReturnType<typeof setup>;
async function world(over: Parameters<typeof setup>[0] = {}) {
  const t = setup(over);
  const key = await seedMerchant(t.db);
  const claim = (label: unknown, k = key) => t.req("/v1/ens/claim-name", { method: "POST", key: k, idem: crypto.randomUUID(), body: JSON.stringify({ label }) });
  return { t, key, claim };
}
const MEMBER = "0x7777777777777777777777777777777777777777";

describe("POST /v1/ens/claim-name", () => {
  it("gives the business its own name, with its own resolver, pointing at its payout account", async () => {
    const { t, claim } = await world();
    const res = await claim("acme");
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ name: "acme.stenmont.eth", resolver: RESOLVER, payoutLocked: false });
    expect(t.ens.claims).toEqual([{ label: "acme", payout: MERCHANT_ADDRESS }]);
    const [row] = await dbOf(t.db).select().from(ensNames);
    expect(row).toMatchObject({ merchantId: "m_1", label: "acme", resolver: RESOLVER, agentRegistry: AGENT_REGISTRY, payoutLocked: 0, status: "active" });
  });
  it("accepts only plain lowercase labels, 3 to 32 characters, and keeps platform words for the platform", async () => {
    const { claim } = await world();
    for (const bad of ["Acme", "ac me", "ac", "a".repeat(33), "-acme", "acme-", "acme.shop", "ac_me", "acmé", "", 5, "www", "api", "app", "admin", "stenmont"]) {
      const res = await claim(bad);
      expect(res.status, String(bad)).toBe(400);
    }
    expect((await claim("a-b-c")).status).toBe(201);
  });
  it("a name that is taken (in our records or on chain) is a clear 409 and leaves nothing half-made", async () => {
    const { t, key, claim } = await world();
    expect((await claim("acme")).status).toBe(201);
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    const dup = await claim("acme", other);
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("label_taken");

    t.ens.taken.add("ghost"); // registered on chain by someone else
    const onChain = await claim("ghost", other);
    expect(onChain.status).toBe(409);
    expect(await dbOf(t.db).select().from(ensNames)).toHaveLength(1); // no row for the failed attempts
    void key;
  });
  it("a business gets one name", async () => {
    const { claim } = await world();
    await claim("acme");
    const again = await claim("acme-two");
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("name_exists");
  });
  it("a chain failure answers 502, stores nothing, and the same label can be tried again", async () => {
    let fail = true;
    const { t, claim } = await world();
    const original = t.ens.claimBusinessName.bind(t.ens);
    t.ens.claimBusinessName = async (a) => {
      if (fail) throw new Error("sepolia down");
      return original(a);
    };
    expect((await claim("acme")).status).toBe(502);
    expect(await dbOf(t.db).select().from(ensNames)).toHaveLength(0);
    fail = false;
    expect((await claim("acme")).status).toBe(201);
  });
  it("needs a signed-in business with an account", async () => {
    const { t } = await world();
    expect((await t.req("/v1/ens/claim-name", { method: "POST", body: JSON.stringify({ label: "acme" }) })).status).toBe(401);
  });
});

describe("GET /v1/ens/name", () => {
  it("returns the business's own name, 404 before it has one, and never another business's", async () => {
    const { t, key, claim } = await world();
    expect((await t.req("/v1/ens/name", { key })).status).toBe(404);
    await claim("acme");
    expect(await json(await t.req("/v1/ens/name", { key }))).toMatchObject({ name: "acme.stenmont.eth", payoutLocked: false });
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect((await t.req("/v1/ens/name", { key: other })).status).toBe(404);
  });
});

describe("dashboard ENS reads", () => {
  it("checks a valid label against chain state without claiming it", async () => {
    const { t, key } = await world();
    const r = await t.req("/v1/ens/availability?label=acme", { key });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ label: "acme", available: true });
    expect(t.ens.claims).toHaveLength(0);
    t.ens.taken.add("acme");
    expect(await json(await t.req("/v1/ens/availability?label=acme", { key }))).toEqual({ label: "acme", available: false });
  });
  it("rejects invalid or reserved labels and requires authentication", async () => {
    const { t, key } = await world();
    for (const label of ["", "api", "Bad Name", "ab", "-abc"]) {
      expect((await t.req(`/v1/ens/availability?label=${encodeURIComponent(label)}`, { key })).status).toBe(400);
    }
    expect((await t.req("/v1/ens/availability?label=acme")).status).toBe(401);
  });
  it("never calls an unavailable provider an available name", async () => {
    const { t, key } = await world();
    t.ens.labelAvailable = async () => { throw new Error("RPC unavailable"); };
    const r = await t.req("/v1/ens/availability?label=acme", { key });
    expect(r.status).toBe(502);
    expect((await json(r)).error.code).toBe("chain_error");
  });
  it("resolves only the authenticated business's name from the live provider", async () => {
    const { t, key, claim } = await world();
    expect((await t.req("/v1/ens/resolution", { key })).status).toBe(404);
    await claim("acme");
    const names: string[] = [];
    t.ens.resolveAddress = async (name) => { names.push(name); return MEMBER; };
    const r = await t.req("/v1/ens/resolution", { key });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ name: "acme.stenmont.eth", address: MEMBER });
    expect(names).toEqual(["acme.stenmont.eth"]);
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect((await t.req("/v1/ens/resolution?name=acme.stenmont.eth", { key: other })).status).toBe(404);
    expect(names).toHaveLength(1);
    t.ens.resolveAddress = async () => { throw new Error("RPC unavailable"); };
    expect((await t.req("/v1/ens/resolution", { key })).status).toBe(502);
  });
});

describe("finance role and payout lock", () => {
  it("lets the business give a team member the right to edit only the profile record", async () => {
    const { t, key, claim } = await world();
    await claim("acme");
    const res = await t.req("/v1/ens/finance", { method: "POST", key, idem: "f1", body: JSON.stringify({ member: MEMBER }) });
    expect(res.status).toBe(200);
    expect(t.ens.finance).toEqual([{ name: "acme.stenmont.eth", member: MEMBER }]);
    expect((await t.req("/v1/ens/finance", { method: "POST", key, idem: "f2", body: JSON.stringify({ member: "nope" }) })).status).toBe(400);
  });
  it("locks the payout for good: after that no more members can be added and it cannot be locked twice", async () => {
    const { t, key, claim } = await world();
    await claim("acme");
    const lock = await t.req("/v1/ens/lock-payout", { method: "POST", key, idem: "l1", body: "{}" });
    expect(lock.status).toBe(200);
    expect(await json(lock)).toMatchObject({ payoutLocked: true });
    expect(t.ens.locks).toEqual(["acme.stenmont.eth"]);
    expect((await json(await t.req("/v1/ens/name", { key }))).payoutLocked).toBe(true);

    const late = await t.req("/v1/ens/finance", { method: "POST", key, idem: "f3", body: JSON.stringify({ member: MEMBER }) });
    expect(late.status).toBe(409);
    expect((await json(late)).error.code).toBe("payout_locked");
    expect((await t.req("/v1/ens/lock-payout", { method: "POST", key, idem: "l2", body: "{}" })).status).toBe(409);
    expect(t.ens.locks).toHaveLength(1);
  });
  it("needs a name first", async () => {
    const { t, key } = await world();
    expect((await t.req("/v1/ens/lock-payout", { method: "POST", key, idem: "l3", body: "{}" })).status).toBe(404);
  });
});
void (null as unknown as T);
