import { expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { CHECKS, runChecks } from "../src/sites/checks";
import { seedMerchant, setup } from "./helpers/app";
import { fakeNet } from "./helpers/net";

const never = (() => new Promise<Response>(() => {})) as typeof fetch;
const site = { id: "s1", merchantId: "m_1", url: "https://shop.example.com", host: "shop.example.com", token: "t".repeat(32) };

it("a fetcher that never answers cannot hold a full check beyond the per-check deadline, and checks run in parallel", async () => {
  const t = setup();
  const db = drizzle(t.db);
  await seedMerchant(t.db);
  await t.db.prepare("insert into sites (id, merchant_id, url, host, token, created_at) values (?,?,?,?,?,?)").bind(site.id, site.merchantId, site.url, site.host, site.token, "2026-11-06T00:00:00Z").run();
  await t.db.prepare("insert into webhook_endpoints (id, merchant_id, url, secret, active, created_at) values (?,?,?,?,1,?)").bind("w1", "m_1", "https://shop.example.com/hook", "whsec_x", "2026-11-06T00:00:00Z").run();
  const started = Date.now();
  await runChecks({ db, fetch: never, now: t.clock.now, deadlineMs: 150 }, site, CHECKS);
  const elapsed = Date.now() - started;
  // Sequential would be at least 3 x 150 ms (reachable, domain, webhook all hang).
  expect(elapsed).toBeGreaterThanOrEqual(140);
  expect(elapsed).toBeLessThan(400);
  const rows = (await t.db.prepare("select kind, ok, detail from site_checks order by kind").all()).results as { kind: string; ok: number; detail: string }[];
  expect(rows.map((r) => r.kind)).toEqual(["domain", "payment", "reachable", "webhook"]);
  for (const k of ["domain", "reachable", "webhook"]) expect(rows.find((r) => r.kind === k)).toMatchObject({ ok: 0, detail: "This check took too long to answer. Try again." });
  expect(rows.find((r) => r.kind === "payment")!.detail).not.toContain("too long"); // database-only check is not slowed by the others
});

it("the real default deadline is 5 seconds for each of reachability, DNS and webhook", async () => {
  const { CHECK_DEADLINE_MS } = await import("../src/sites/checks");
  expect(CHECK_DEADLINE_MS).toBe(5_000);
});

it("registering a site starts the first check in the background and still answers at once", async () => {
  const net = fakeNet({ a: { "shop.example.com": ["93.184.216.34"] }, sites: { "shop.example.com": () => new Response("ok") } });
  const t = setup({}, {}, { fetch: net.fetch });
  const key = await seedMerchant(t.db);
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const res = await t.app.request("/v1/sites", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ url: "https://shop.example.com" }) }, t.env, ctx);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; checking: boolean; checks: Record<string, unknown> };
  expect(body.checking).toBe(true);
  expect(body.checks.reachable).toBeNull(); // the answer did not wait for the checks
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  const after = (await (await t.req(`/v1/sites/${body.id}`, { key })).json()) as { checks: Record<string, { ok: boolean } | null> };
  expect(after.checks.reachable).toMatchObject({ ok: true });
  expect(after.checks.domain).toMatchObject({ ok: false });
  expect(after.checks.webhook).not.toBeNull();
  expect(after.checks.payment).not.toBeNull();
});

it("a full check with slow-but-answering lookups finishes inside the budget", async () => {
  const slow = fakeNet({ a: { "shop.example.com": ["93.184.216.34"] }, sites: { "shop.example.com": () => new Response("ok") } });
  const lag: typeof fetch = async (i, o) => { await new Promise((r) => setTimeout(r, 40)); return slow.fetch(i, o); };
  const t = setup({}, {}, { fetch: lag });
  const key = await seedMerchant(t.db);
  const id = ((await (await t.req("/v1/sites", { method: "POST", key, body: JSON.stringify({ url: "https://shop.example.com" }) })).json()) as { id: string }).id;
  const started = Date.now();
  const res = await t.req(`/v1/sites/${id}/check`, { method: "POST", key, body: "{}" });
  expect(res.status).toBe(200);
  expect(Date.now() - started).toBeLessThan(8_000);
});
