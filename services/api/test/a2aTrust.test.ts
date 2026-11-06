import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { verifyBusinessTrust } from "@stenmont/shared";
import { setup, seedMerchant, PAYOUT_ADDRESS } from "./helpers/app";
import { json } from "./helpers/oauth";
const key = `0x${"42".repeat(32)}` as const;
async function facts() {
  const s = setup({}, { A2A_ATTESTER_PRIVATE_KEY: key, WORLD_ENVIRONMENT: "staging" }, { fetch: (async () => Response.json({ Status: 0, Answer: [{ type: 16, data: '"stenmont-verify=proof"' }] })) as typeof fetch });
  const apiKey = await seedMerchant(s.db);
  const now = s.clock.now.toISOString();
  await s.db.prepare("INSERT INTO a2a_access (merchant_id,enabled,skills,updated_at) VALUES ('m_1',1,'[]',?)").bind(now).run();
  await s.db.prepare("INSERT INTO ens_names (merchant_id,label,name,resolver,agent_registry,status,created_at) VALUES ('m_1','acme','acme.stenmont.eth',?,?, 'active',?)").bind(PAYOUT_ADDRESS, PAYOUT_ADDRESS, now).run();
  await s.db.prepare("INSERT INTO world_enrollments (id,merchant_id,action,nullifier,verified_at,proof_environment) VALUES ('w','m_1','enrol-business','1',?,'staging')").bind(now).run();
  await s.db.prepare("INSERT INTO sites (id,merchant_id,url,host,token,created_at) VALUES ('s','m_1','https://acme.example','acme.example','proof',?)").bind(now).run();
  s.ens.resolveAddress = async () => PAYOUT_ADDRESS;
  return { ...s, apiKey };
}
describe("truth observations and registrar publication", () => {
  it("signs only complete live-observed facts, labels World staging and never exposes a nullifier", async () => {
    const s = await facts(); const r = await s.req("/a2a/m_1/trust"); expect(r.status).toBe(200);
    const a = await json(r);
    expect(a.claims.environment).toBe("test/world:staging");
    expect(JSON.stringify(a)).not.toContain("nullifier");
    expect(await verifyBusinessTrust(a as any, { signer: privateKeyToAccount(key).address, ensName: "acme.stenmont.eth", environment: "test/world:staging", now: Math.floor(s.clock.now.getTime()/1000) })).toBe(true);
    s.ens.resolveAddress = async () => null;
    expect((await s.req("/a2a/m_1/trust")).status).toBe(409);
  });
  it("does not invent an enrollment or a signer", async () => {
    const s = await facts(); await s.db.prepare("DELETE FROM world_enrollments").run();
    expect((await s.req("/a2a/m_1/trust")).status).toBe(409);
    delete s.env.A2A_ATTESTER_PRIVATE_KEY;
    expect((await s.req("/a2a/m_1/trust")).status).toBe(503);
  });
  it("publishes only the server-generated card URL via the registrar", async () => {
    const s = await facts();
    expect((await s.req("/v1/agent-access/publish-ens", { method: "POST" })).status).toBe(401);
    const r = await s.req("/v1/agent-access/publish-ens", { method: "POST", key: s.apiKey, body: JSON.stringify({ records: { "stenmont.a2a": "https://evil.example" } }) });
    expect(r.status).toBe(200);
    expect(s.ens.textWrites[0]!.records).toEqual({ "stenmont.a2a": "https://api.test/a2a/m_1/agent-card.json" });
    expect((await s.req("/v1/agent-access", { method: "PUT", key: s.apiKey, body: JSON.stringify({ enabled: true, skills: [], records: { "stenmont.a2a": "evil" } }) })).status).toBe(400);
  });
});
