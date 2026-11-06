import { describe, expect, it } from "vitest";
import { setup, seedMerchant } from "./helpers/app";
import { connect } from "./helpers/oauth";
import { seedInvoice } from "./helpers/fixtures";
const rpc = (method: string, params: unknown = {}) => JSON.stringify({ jsonrpc: "2.0", id: "r1", method, params });
const message = (skill: string, input: unknown = {}) => ({ message: { messageId: "msg1", role: "ROLE_USER", parts: [{ data: { skill, input } }] } });
async function ready() {
  const s = setup(); const key = await seedMerchant(s.db);
  // Settings are merchant-owned; fixture enables the bounded surface directly.
  await s.db.prepare("INSERT INTO a2a_access (merchant_id,enabled,skills,updated_at) VALUES (?,1,?,?)").bind("m_1", JSON.stringify(["quote", "create_invoice_draft", "check_invoice_status", "get_pay_link", "list_catalogue"]), s.clock.now.toISOString()).run();
  const send = async (method: string, params?: unknown, merchant = "m_1"): Promise<any> => s.req(`/v1/a2a/${merchant}`, { method: "POST", key, headers: { "A2A-Version": "1.0" }, body: rpc(method, params) });
  const req = async (...args: Parameters<typeof s.req>): Promise<any> => s.req(...args);
  return { ...s, req, key, send };
}
describe("A2A 1.0 bounded RPC", () => {
  it("publishes platform and opted-in business cards with no invented trust", async () => {
    const s = await ready();
    const platform = await (await s.req("/.well-known/agent-card.json")).json();
    expect(platform.supportedInterfaces[0].protocolVersion).toBe("1.0");
    const card = await (await s.req("/a2a/m_1/agent-card.json")).json();
    expect(card.skills).toHaveLength(5); expect(card.signatures).toBeUndefined();
    expect(card.capabilities.streaming).toBe(false);
  });
  it("refuses anonymous calls, cross-tenant use, wrong versions and old methods", async () => {
    const s = await ready();
    expect((await s.req("/v1/a2a/m_1", { method: "POST", body: rpc("GetTask") })).status).toBe(401);
    expect((await s.send("GetTask", {}, "m_other")).status).toBe(403);
    expect((await (await s.send("message/send")).json()).error.code).toBe(-32601);
    const wrong = await s.req("/v1/a2a/m_1", { method: "POST", key: s.key, body: rpc("GetTask") });
    expect((await wrong.json()).error.code).toBe(-32009);
  });
  it("creates and retrieves a draft task without creating an invoice or moving funds", async () => {
    const s = await ready(); const before = await s.db.prepare("SELECT count(*) n FROM invoices").first("n");
    const result = await (await s.send("SendMessage", message("create_invoice_draft", { number: "INV-NEW", amount: "12.34" }))).json();
    expect(result.result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(result.result.task.artifacts[0].parts[0].data.requiresMerchantConfirmation).toBe(true);
    const id = result.result.task.id;
    expect((await (await s.send("GetTask", { id })).json()).result.id).toBe(id);
    expect((await (await s.send("CancelTask", { id })).json()).error.code).toBe(-32002);
    expect(await s.db.prepare("SELECT count(*) n FROM invoices").first("n")).toBe(before);
  });
  it("only exposes own invoice fields and forbids money skills", async () => {
    const s = await ready(); const id = await seedInvoice(s.db);
    const task = (await (await s.send("SendMessage", message("check_invoice_status", { invoiceId: id }))).json()).result.task;
    expect(task.artifacts[0].parts[0].data.status).toBe("open");
    expect((await (await s.send("SendMessage", message("refund", {}))).json()).error.code).toBe(-32602);
    expect((await (await s.send("GetTask", { id: "missing" })).json()).error.code).toBe(-32001);
  });
  it("revocation hides the card and blocks already connected calls", async () => {
    const s = await ready();
    await s.db.prepare("UPDATE a2a_access SET enabled=0 WHERE merchant_id=?").bind("m_1").run();
    expect((await s.req("/a2a/m_1/agent-card.json")).status).toBe(404);
    expect((await s.send("SendMessage", message("list_catalogue"))).status).toBe(403);
  });
  it("rejects malformed, oversized and multi-part inputs", async () => {
    const s = await ready();
    expect((await (await s.send("SendMessage", { message: { role: "ROLE_USER", parts: [{ text: "execute payment" }] } })).json()).error.code).toBe(-32602);
    const r = await s.req("/v1/a2a/m_1", { method: "POST", key: s.key, headers: { "A2A-Version": "1.0" }, body: "x".repeat(17000) });
    expect(r.status).toBe(413);
  });
});

describe("A2A scope boundary", () => {
  it("allows read OAuth for reads but requires draft scope for drafts and refuses settings", async () => {
    const s = await ready(); const connected = await connect(s, "read");
    const call = (skill: string, input = {}) => s.req("/v1/a2a/m_1", { method: "POST", headers: { authorization: `Bearer ${connected.tokens.access_token}`, "A2A-Version": "1.0" }, body: rpc("SendMessage", message(skill, input)) });
    expect((await call("list_catalogue")).status).toBe(200);
    expect((await call("create_invoice_draft", { number: "draft", amount: "1" })).status).toBe(403);
    expect((await s.req("/v1/agent-access", { method: "PUT", headers: { authorization: `Bearer ${connected.tokens.access_token}` }, body: JSON.stringify({ enabled: true, skills: ["quote"] }) })).status).toBe(403);
  });
  it("enforces API key scopes and idempotent message ids", async () => {
    const s = await ready();
    const first = await (await s.send("SendMessage", message("list_catalogue"))).json();
    const second = await (await s.send("SendMessage", message("list_catalogue"))).json();
    expect(second.result.task.id).toBe(first.result.task.id);
    await s.db.prepare("UPDATE api_keys SET scopes='read'").run();
    expect((await s.send("SendMessage", message("create_invoice_draft", { number: "draft", amount: "1" }))).status).toBe(403);
  });
});

describe("A2A task quotas and settings revocation", () => {
  it("atomically caps concurrent new tasks and lets a draft-scoped app create drafts", async () => {
    const s = await ready(); const conn = await connect(s, "draft");
    const headers = { authorization: `Bearer ${conn.tokens.access_token}`, "A2A-Version": "1.0" };
    const draft = await s.req("/v1/a2a/m_1", { method: "POST", headers, body: rpc("SendMessage", message("create_invoice_draft", { number: "draft", amount: "1" })) });
    expect(draft.status).toBe(200);
    for (let n = 0; n < 198; n++) await s.db.prepare("INSERT INTO a2a_tasks (id,merchant_id,message_id,input_hash,task,created_at,expires_at) VALUES (?,'m_1',?,'h','{}',?,?)").bind(`seed-${n}`, `seed-${n}`, s.clock.now.toISOString(), "2027-01-01T00:00:00Z").run();
    const responses = await Promise.all(Array.from({ length: 5 }, (_, n) => s.req("/v1/a2a/m_1", { method: "POST", key: s.key, headers: { "A2A-Version": "1.0" }, body: rpc("SendMessage", { message: { ...message("list_catalogue").message, messageId: `concurrent-${n}` } }) })));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => r.status === 429)).toHaveLength(4);
  });
  it("blocks a cached OAuth credential immediately after merchant revocation", async () => {
    const s = await ready(); const conn = await connect(s, "read");
    expect((await s.req("/v1/agent-access", { method: "POST", key: s.key, body: JSON.stringify({ enabled: false, skills: [] }) })).status).toBe(200);
    expect((await s.req("/v1/a2a/m_1", { method: "POST", headers: { authorization: `Bearer ${conn.tokens.access_token}`, "A2A-Version": "1.0" }, body: rpc("SendMessage", message("list_catalogue")) })).status).toBe(403);
  });
});
