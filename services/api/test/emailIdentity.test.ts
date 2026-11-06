import { expect, it } from "vitest";
import { setup } from "./helpers/app";
import type { MailMessage } from "../src/email/transactional";
function fixture() {
  const messages: MailMessage[] = [];
  const t = setup({}, { EMAIL_CODE_SECRET: "fixture-only-pepper-not-a-secret", EMAIL_MODE: "live", EMAIL: { send: async (m) => { messages.push(m); } } });
  const post = (path: string, body: unknown) => t.req(path, { method: "POST", headers: { origin: t.env.APP_URL }, body: JSON.stringify(body) });
  return { ...t, messages, post };
}
it("stores a keyed hash; refuses wrong, expired and replayed codes", async () => {
  const t = fixture();
  const begin = await t.post("/auth/email/start", { email: "person@example.invalid" });
  expect(begin.status).toBe(200); const { id } = await begin.json() as { id: string };
  const code = t.messages[0]!.text.match(/Your code is (\d{8})/)![1]!;
  const row = await t.db.prepare("select * from identity_email_codes where id=?").bind(id).first();
  expect(JSON.stringify(row)).not.toContain(code);
  expect((await t.post("/auth/email/verify", { id, code: "00000000" })).status).toBe(401);
  const ok = await t.post("/auth/email/verify", { id, code }); expect(ok.status).toBe(200);
  expect(ok.headers.get("set-cookie")).toContain("HttpOnly");
  expect((await t.post("/auth/email/verify", { id, code })).status).toBe(401);
  const next = await t.post("/auth/email/start", { email: "person@example.invalid" });
  const nextId = (await next.json() as { id: string }).id;
  const expiringCode = t.messages[1]!.text.match(/Your code is (\d{8})/)![1]!;
  t.clock.now = new Date(t.clock.now.getTime() + 600_001);
  expect((await t.post("/auth/email/verify", { id: nextId, code: expiringCode })).status).toBe(401);
});
it("limits guesses and issue requests and requires our own origin", async () => {
  const t = fixture(); const begin = await t.post("/auth/email/start", { email: "person@example.invalid" });
  const { id } = await begin.json() as { id: string };
  const code = t.messages[0]!.text.match(/Your code is (\d{8})/)![1]!;
  for(let i=0;i<5;i++) expect((await t.post("/auth/email/verify", { id, code: "wrong" })).status).toBe(401);
  expect((await t.post("/auth/email/verify", { id, code })).status).toBe(401);
  for(let i=0;i<2;i++) expect((await t.post("/auth/email/start", { email: "person@example.invalid" })).status).toBe(200);
  expect((await t.post("/auth/email/start", { email: "person@example.invalid" })).status).toBe(429);
  expect((await t.req("/auth/email/start", { method: "POST", body: JSON.stringify({ email: "x@example.invalid" }) })).status).toBe(403);
});

it("links only with an existing passkey session; recovered dashboard access cannot mutate", async () => {
  const { seedMerchant } = await import("./helpers/app");
  const { sha256Hex } = await import("../src/lib/crypto");
  const t = fixture(); await seedMerchant(t.db);
  const start = await t.post("/auth/email/start", { email: "owner@example.invalid" });
  const { id } = await start.json() as { id: string };
  const code = t.messages[0]!.text.match(/Your code is (\d{8})/)![1]!;
  const verified = await t.post("/auth/email/verify", { id, code });
  const identityCookie = verified.headers.get("set-cookie")!.match(/__Secure-stenmont_identity_test=([a-f0-9]{64})/)![0];
  expect((await t.req("/auth/identity/link", { method:"POST", headers:{origin:t.env.APP_URL,cookie:identityCookie} })).status).toBe(403);
  const session = "a".repeat(64);
  await t.db.prepare("INSERT INTO sessions(token_hash,merchant_id,passkey_id,expires_at,created_at) VALUES(?,?,?,?,?)").bind(await sha256Hex(session),"m_1","fixture-passkey","2027-01-01T00:00:00Z",t.clock.now.toISOString()).run();
  expect((await t.req("/auth/identity/link", { method:"POST", headers:{origin:t.env.APP_URL,cookie:`${identityCookie}; __Secure-stenmont_test=${session}`} })).status).toBe(200);
  expect((await t.req("/v1/me", {headers:{cookie:identityCookie}})).status).toBe(200);
  // A revoked/expired passkey cookie must not shadow a freshly verified recovery identity.
  expect((await t.req("/v1/me", {headers:{cookie:`${identityCookie}; __Secure-stenmont_test=${"b".repeat(64)}`}})).status).toBe(200);
  expect((await t.req("/v1/invoices", {method:"POST",headers:{origin:t.env.APP_URL,cookie:identityCookie},body:"{}"})).status).toBe(403);
});
