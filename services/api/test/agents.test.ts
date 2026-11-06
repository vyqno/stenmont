import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ensAgents } from "../src/db/schema";
import { createApproval } from "../src/world/approvals";
import { d1ApprovalRepo } from "../src/world/d1";
import { seedMerchant, setup } from "./helpers/app";
import { dbOf } from "./helpers/fixtures";

const json = async (r: Response) => (await r.json()) as Record<string, any>;
const AGENT = "0x8888888888888888888888888888888888888888";
const body = (over: Record<string, unknown> = {}) => ({ label: "billing-bot", agentAddress: AGENT, scopes: ["invoice.read", "refund.draft"], dailyLimit: "50", perTxLimit: "10", expiresInDays: 30, ...over });

async function world() {
  const t = setup();
  const key = await seedMerchant(t.db);
  await t.req("/v1/ens/claim-name", { method: "POST", key, idem: "c1", body: JSON.stringify({ label: "acme" }) });
  const post = (path: string, b: unknown, k = key) => t.req(path, { method: "POST", key: k, idem: crypto.randomUUID(), body: JSON.stringify(b) });
  return { t, key, post, db: dbOf(t.db) };
}

describe("agents as names under the business", () => {
  it("creates billing-bot.acme.stenmont.eth with its own identity, limits and expiry", async () => {
    const { t, post, db } = await world();
    const res = await post("/v1/ens/agents", body());
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ name: "billing-bot.acme.stenmont.eth", agentAddress: AGENT, scopes: ["invoice.read", "refund.draft"], dailyLimit: "50", perTxLimit: "10", status: "active" });
    const sent = t.ens.agents[0]!;
    expect(sent).toMatchObject({ businessName: "acme.stenmont.eth", label: "billing-bot", agent: AGENT });
    expect(sent.expiresAt).toBe(Math.floor(t.clock.now.getTime() / 1000) + 30 * 86_400);
    expect(JSON.parse(sent.limits)).toEqual({ dailyLimit: "50", perTxLimit: "10", scopes: ["invoice.read", "refund.draft"] });
    expect((await db.select().from(ensAgents))[0]).toMatchObject({ merchantId: "m_1", label: "billing-bot", status: "active" });
  });
  it("needs the business to have a name first, valid terms, and a per-payment limit that fits inside the daily one", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const noName = await t.req("/v1/ens/agents", { method: "POST", key, idem: "a", body: JSON.stringify(body()) });
    expect(noName.status).toBe(404);
    const w = await world();
    for (const bad of [{ label: "Bad Name" }, { label: "ab" }, { agentAddress: "nope" }, { scopes: ["steal"] }, { scopes: [] }, { dailyLimit: "0" }, { perTxLimit: "20", dailyLimit: "10" }, { expiresInDays: 0 }, { expiresInDays: 400 }, { endpoint: "http://x.test" }]) {
      expect((await w.post("/v1/ens/agents", body(bad))).status, JSON.stringify(bad)).toBe(400);
    }
  });
  it("refuses a label that is taken, in our records or on chain, and leaves nothing half-made", async () => {
    const { t, post, db } = await world();
    expect((await post("/v1/ens/agents", body())).status).toBe(201);
    const again = await post("/v1/ens/agents", body());
    expect(again.status).toBe(409);
    expect((await json(again)).error.code).toBe("label_taken");
    t.ens.taken.add("ghost.acme.stenmont.eth");
    expect((await post("/v1/ens/agents", body({ label: "ghost" }))).status).toBe(409);
    expect(await db.select().from(ensAgents)).toHaveLength(1);
  });
  it("a chain failure answers 502, stores nothing, and the same agent can be created afterwards", async () => {
    const { t, post, db } = await world();
    const original = t.ens.createAgent.bind(t.ens);
    let fail = true;
    t.ens.createAgent = async (a) => {
      if (fail) throw new Error("sepolia down");
      return original(a);
    };
    expect((await post("/v1/ens/agents", body())).status).toBe(502);
    expect(await db.select().from(ensAgents)).toHaveLength(0);
    fail = false;
    expect((await post("/v1/ens/agents", body())).status).toBe(201);
  });
  it("lists only this business's agents and marks expired ones", async () => {
    const { t, key, post } = await world();
    await post("/v1/ens/agents", body());
    await post("/v1/ens/agents", body({ label: "short-lived", expiresInDays: 1 }));
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect(((await json(await t.req("/v1/ens/agents", { key: other }))).data as unknown[]).length).toBe(0);
    t.clock.now = new Date(t.clock.now.getTime() + 2 * 86_400_000);
    const list = (await json(await t.req("/v1/ens/agents", { key }))).data as { label: string; status: string }[];
    expect(Object.fromEntries(list.map((a) => [a.label, a.status]))).toEqual({ "billing-bot": "active", "short-lived": "expired" });
  });
  it("revoking takes the agent's right to edit its record away and removes its name; it cannot be done twice", async () => {
    const { t, key, post, db } = await world();
    await post("/v1/ens/agents", body());
    const res = await t.req("/v1/ens/agents/billing-bot", { method: "DELETE", key });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ label: "billing-bot", status: "revoked" });
    expect(t.ens.revoked[0]).toMatchObject({ label: "billing-bot", agent: AGENT });
    expect((await db.select().from(ensAgents).where(eq(ensAgents.label, "billing-bot")))[0]!.status).toBe("revoked");
    expect((await t.req("/v1/ens/agents/billing-bot", { method: "DELETE", key })).status).toBe(409);
    expect((await t.req("/v1/ens/agents/nobody", { method: "DELETE", key })).status).toBe(404);
    expect(t.ens.revoked).toHaveLength(1);
  });
  it("another business cannot revoke it", async () => {
    const { t, post } = await world();
    await post("/v1/ens/agents", body());
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect((await t.req("/v1/ens/agents/billing-bot", { method: "DELETE", key: other })).status).toBe(404);
  });
  it("a large daily limit needs a person's approval for exactly those terms, used once", async () => {
    const { t, post } = await world();
    const big = body({ dailyLimit: "500", perTxLimit: "50" });
    const first = await post("/v1/ens/agents", big);
    expect(first.status).toBe(409);
    const e = (await json(first)).error;
    expect(e.code).toBe("approval_required");
    expect(e.details.approvalParams).toEqual({ label: "billing-bot", agentAddress: AGENT, dailyLimit: "500", perTxLimit: "50" });
    const repo = d1ApprovalRepo(dbOf(t.db));
    const approve = async (params: object) => {
      const row = await createApproval(repo, { merchantId: "m_1", operation: "agent_limit", params }, { now: t.clock.now, newId: () => crypto.randomUUID(), newNonce: () => "n" });
      await repo.transition(row.id, "pending", { status: "approved", worldSub: "h", authTime: Math.floor(t.clock.now.getTime() / 1000) });
    };
    await approve({ label: "billing-bot", agentAddress: AGENT, dailyLimit: "400", perTxLimit: "50" }); // different terms
    expect((await post("/v1/ens/agents", big)).status).toBe(409);
    await approve(e.details.approvalParams);
    expect((await post("/v1/ens/agents", big)).status).toBe(201);
    expect((await post("/v1/ens/agents", body({ label: "second", dailyLimit: "500", perTxLimit: "50" }))).status).toBe(409); // used up
  });
});
