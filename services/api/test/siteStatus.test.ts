import { verifyWebhook } from "@stenmont/sdk";
import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";
import { seedEndpoint, seedInvoice } from "./helpers/fixtures";
import { fakeNet, type FakeNet } from "./helpers/net";

const PUBLIC_IP = ["93.184.216.34"];
const up = () => new Response("<html>hello</html>", { status: 200 });
const A = `sk_test_${"a".repeat(32)}`;
const B = `sk_test_${"b".repeat(32)}`;

type T = ReturnType<typeof setup>;
type SiteView = {
  id: string;
  url: string;
  host: string;
  verification: { recordName: string; recordValue: string };
  checks: Record<"reachable" | "domain" | "webhook" | "payment", { ok: boolean; detail: string; checkedAt: string } | null>;
  ready: boolean;
};

function world(net: FakeNet = fakeNet({ a: { "shop.example.com": PUBLIC_IP }, sites: { "shop.example.com": up } })) {
  const t = setup({}, {}, { fetch: net.fetch });
  return { t, net };
}
const json = (b: unknown) => JSON.stringify(b);
const register = async (t: T, key: string, url = "https://shop.example.com") => t.req("/v1/sites", { method: "POST", key, body: json({ url }) });
const registered = async (t: T, key: string, url?: string) => (await (await register(t, key, url)).json()) as SiteView;
const check = async (t: T, key: string, id: string, checks?: string[]) =>
  t.req(`/v1/sites/${id}/check`, { method: "POST", key, body: json(checks ? { checks } : {}) });

describe("registering a site", () => {
  it("stores it and says exactly which DNS record proves ownership", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const res = await register(t, key, "https://Shop.Example.com/");
    expect(res.status).toBe(201);
    const site = (await res.json()) as SiteView;
    expect(site).toMatchObject({ url: "https://shop.example.com", host: "shop.example.com", ready: false });
    expect(site.verification.recordName).toBe("_stenmont.shop.example.com");
    expect(site.verification.recordValue).toMatch(/^stenmont-verify=[0-9a-f]{32}$/);
    expect(site.checks).toEqual({ reachable: null, domain: null, webhook: null, payment: null });
    const list = (await (await t.req("/v1/sites", { key })).json()) as { data: SiteView[] };
    expect(list.data.map((s) => s.id)).toEqual([site.id]);
  });
  it.each([
    ["localhost", "https://localhost/"],
    ["loopback", "https://127.0.0.1/"],
    ["private 10.x", "https://10.1.2.3/"],
    ["link-local metadata", "https://169.254.169.254/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["plain http", "http://shop.example.com/"],
    ["credentials", "https://me:secret@shop.example.com/"],
    ["not a url", "shop"],
  ])("refuses %s and stores nothing", async (_n, url) => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const res = await register(t, key, url);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_site_url");
    expect((await t.db.prepare("select count(*) as n from sites").first("n"))).toBe(0);
  });
  it("refuses unknown fields, a second registration of the same site, and more than five sites", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    expect((await t.req("/v1/sites", { method: "POST", key, body: json({ url: "https://shop.example.com", admin: true }) })).status).toBe(400);
    expect((await register(t, key)).status).toBe(201);
    expect((await register(t, key, "https://shop.example.com/other")).status).toBe(409);
    for (const n of [1, 2, 3, 4]) expect((await register(t, key, `https://s${n}.example.com`)).status).toBe(201);
    const sixth = await register(t, key, "https://s5.example.com");
    expect(sixth.status).toBe(409);
    expect(((await sixth.json()) as { error: { code: string } }).error.code).toBe("too_many_sites");
  });
  it("needs a login", async () => {
    const { t } = world();
    expect((await t.req("/v1/sites")).status).toBe(401);
    expect((await t.req("/v1/payment-switch")).status).toBe(401);
  });
});

describe("tenant isolation", () => {
  it("merchant B cannot list, read, check, change or delete merchant A's site", async () => {
    const { t } = world();
    const a = await seedMerchant(t.db, "m_1", "Acme", A);
    const b = await seedMerchant(t.db, "m_2", "Beta", B);
    const site = await registered(t, a);
    expect(((await (await t.req("/v1/sites", { key: b })).json()) as { data: unknown[] }).data).toEqual([]);
    expect((await t.req(`/v1/sites/${site.id}`, { key: b })).status).toBe(404);
    expect((await check(t, b, site.id)).status).toBe(404);
    expect((await t.req(`/v1/sites/${site.id}`, { method: "DELETE", key: b })).status).toBe(404);
    expect((await t.req(`/v1/sites/${site.id}`, { key: a })).status).toBe(200);
  });
  it("two businesses can register the same address but each gets its own token", async () => {
    const { t } = world();
    const a = await seedMerchant(t.db, "m_1", "Acme", A);
    const b = await seedMerchant(t.db, "m_2", "Beta", B);
    const sa = await registered(t, a);
    const sb = await registered(t, b);
    expect(sa.verification.recordValue).not.toBe(sb.verification.recordValue);
  });
  it("one business's DNS record does not verify another's site", async () => {
    const net = fakeNet({ a: { "shop.example.com": PUBLIC_IP }, sites: { "shop.example.com": up } });
    const { t } = world(net);
    const a = await seedMerchant(t.db, "m_1", "Acme", A);
    const b = await seedMerchant(t.db, "m_2", "Beta", B);
    const sa = await registered(t, a);
    const sb = await registered(t, b);
    net.txt["_stenmont.shop.example.com"] = [sa.verification.recordValue];
    expect(((await (await check(t, a, sa.id, ["domain"])).json()) as SiteView).checks.domain!.ok).toBe(true);
    expect(((await (await check(t, b, sb.id, ["domain"])).json()) as SiteView).checks.domain!.ok).toBe(false);
  });
});

describe("check: reachable", () => {
  it("passes for a live site and records when", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    const out = (await (await check(t, key, site.id, ["reachable"])).json()) as SiteView;
    expect(out.checks.reachable).toMatchObject({ ok: true, checkedAt: t.clock.now.toISOString() });
    expect(out.checks.domain).toBeNull();
  });
  it("fails for a site that is down, and refuses to probe a name that points at a private address", async () => {
    const down = world(fakeNet({ a: { "shop.example.com": PUBLIC_IP }, sites: { "shop.example.com": () => new Response("x", { status: 502 }) } }));
    const k1 = await seedMerchant(down.t.db);
    const s1 = await registered(down.t, k1);
    expect(((await (await check(down.t, k1, s1.id, ["reachable"])).json()) as SiteView).checks.reachable!.ok).toBe(false);

    const sneaky = world(fakeNet({ a: { "shop.example.com": ["10.0.0.5"] }, sites: { "shop.example.com": up } }));
    const k2 = await seedMerchant(sneaky.t.db);
    const s2 = await registered(sneaky.t, k2);
    const out = (await (await check(sneaky.t, k2, s2.id, ["reachable"])).json()) as SiteView;
    expect(out.checks.reachable!.ok).toBe(false);
    expect(sneaky.net.log.some((l) => l.url.startsWith("https://shop.example.com"))).toBe(false);
  });
});

describe("check: domain", () => {
  it("passes when the TXT record carries this site's token", async () => {
    const { t, net } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    net.txt[site.verification.recordName] = ["v=spf1 -all", site.verification.recordValue];
    const out = (await (await check(t, key, site.id, ["domain"])).json()) as SiteView;
    expect(out.checks.domain).toMatchObject({ ok: true, checkedAt: t.clock.now.toISOString() });
  });
  it("fails when the token is different, when there is no record, and says a DNS outage is not a mismatch", async () => {
    const { t, net } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    net.txt[site.verification.recordName] = ["stenmont-verify=" + "0".repeat(32)];
    const wrong = (await (await check(t, key, site.id, ["domain"])).json()) as SiteView;
    expect(wrong.checks.domain!.ok).toBe(false);
    expect(wrong.checks.domain!.detail).toContain("does not match");
    delete net.txt[site.verification.recordName];
    const none = (await (await check(t, key, site.id, ["domain"])).json()) as SiteView;
    expect(none.checks.domain!.ok).toBe(false);
    expect(none.checks.domain!.detail).toContain(site.verification.recordName);

    const outage = world(Object.assign(fakeNet(), { fetch: (async () => { throw new TypeError("down"); }) as typeof fetch }));
    const k2 = await seedMerchant(outage.t.db);
    const s2 = await registered(outage.t, k2);
    const out = (await (await check(outage.t, k2, s2.id, ["domain"])).json()) as SiteView;
    expect(out.checks.domain!.ok).toBe(false);
    expect(out.checks.domain!.detail).toContain("DNS lookup did not work");
  });
  it("a token with extra text around it does not pass", async () => {
    const { t, net } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    net.txt[site.verification.recordName] = [`x ${site.verification.recordValue} y`, `${site.verification.recordValue}0`];
    expect(((await (await check(t, key, site.id, ["domain"])).json()) as SiteView).checks.domain!.ok).toBe(false);
  });
});

describe("check: webhook", () => {
  it("fails with a plain instruction when no endpoint is registered for the site", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    const out = (await (await check(t, key, site.id, ["webhook"])).json()) as SiteView;
    expect(out.checks.webhook!.ok).toBe(false);
    expect(out.checks.webhook!.detail).toContain("shop.example.com");
  });
  it("ignores endpoints on other hosts and other businesses' endpoints, and sends them nothing", async () => {
    const { t, net } = world();
    const a = await seedMerchant(t.db, "m_1", "Acme", A);
    await seedMerchant(t.db, "m_2", "Beta", B);
    net.sites["hooks.other.example"] = up;
    net.sites["shop.example.com"] = up;
    await seedEndpoint(t.db, { merchantId: "m_1", url: "https://hooks.other.example/stenmont" });
    await seedEndpoint(t.db, { merchantId: "m_2", url: "https://shop.example.com/stenmont" });
    const site = await registered(t, a);
    const out = (await (await check(t, a, site.id, ["webhook"])).json()) as SiteView;
    expect(out.checks.webhook!.ok).toBe(false);
    expect(net.log.some((l) => l.method === "POST")).toBe(false);
  });
  it("sends a signed test event to the site's endpoint and passes on a 2xx answer", async () => {
    const { t, net } = world();
    const key = await seedMerchant(t.db);
    const seen: { body: string; sig: string }[] = [];
    net.sites["shop.example.com"] = async (req) => {
      if (req.method === "POST") seen.push({ body: await req.text(), sig: req.headers.get("stenmont-signature")! });
      return new Response("ok");
    };
    await seedEndpoint(t.db, { url: "https://shop.example.com/webhooks/stenmont", secret: "whsec_site_secret", events: ["invoice.paid"] });
    const site = await registered(t, key);
    const out = (await (await check(t, key, site.id, ["webhook"])).json()) as SiteView;
    expect(out.checks.webhook).toMatchObject({ ok: true, checkedAt: t.clock.now.toISOString() });
    expect(seen).toHaveLength(1);
    const event = await verifyWebhook<{ siteId: string }>(seen[0]!.body, seen[0]!.sig, "whsec_site_secret", { now: Math.floor(t.clock.now.getTime() / 1000) });
    expect(event).toMatchObject({ type: "site.test", livemode: false, data: { siteId: site.id } });
    expect(JSON.stringify(out)).not.toContain("whsec_site_secret");
    const post = net.log.find((l) => l.method === "POST")!;
    expect(post.redirect).toBe("manual");
    expect(post.headers["stenmont-event-id"]).toBe(event.id);
  });
  it.each([
    ["a 500 answer", () => new Response("boom", { status: 500 }), "500"],
    ["a 404 answer", () => new Response("no", { status: 404 }), "404"],
    ["a redirect (it must answer itself)", () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }), "302"],
  ])("fails on %s", async (_n, answer, code) => {
    const { t, net } = world();
    const key = await seedMerchant(t.db);
    net.sites["shop.example.com"] = (req) => (req.method === "POST" ? answer() : up());
    await seedEndpoint(t.db, { url: "https://shop.example.com/webhooks/stenmont" });
    const site = await registered(t, key);
    const out = (await (await check(t, key, site.id, ["webhook"])).json()) as SiteView;
    expect(out.checks.webhook!.ok).toBe(false);
    expect(out.checks.webhook!.detail).toContain(code);
  });
  it("does not deliver to a stored endpoint whose address is no longer acceptable", async () => {
    const { t, net } = world();
    const key = await seedMerchant(t.db);
    await seedEndpoint(t.db, { url: "https://shop.example.com:8443/hook" });
    const site = await registered(t, key);
    expect(((await (await check(t, key, site.id, ["webhook"])).json()) as SiteView).checks.webhook!.ok).toBe(false);
    expect(net.log.some((l) => l.method === "POST")).toBe(false);
  });
});

describe("check: test payment", () => {
  const pay = (t: T, id: string, successUrl: string | null, status = "paid", merchant = "m_1") =>
    t.db.prepare("update invoices set status = ?, success_url = ?, merchant_id = ?, amount_paid = amount, updated_at = '2026-11-06T09:30:00.000Z' where id = ?").bind(status, successUrl, merchant, id).run();

  it("fails until an invoice that returns to this site has been paid", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    const none = (await (await check(t, key, site.id, ["payment"])).json()) as SiteView;
    expect(none.checks.payment!.ok).toBe(false);
    const id = await seedInvoice(t.db);
    await pay(t, id, "https://shop.example.com/thanks", "open");
    expect(((await (await check(t, key, site.id, ["payment"])).json()) as SiteView).checks.payment!.ok).toBe(false);
    await pay(t, id, "https://elsewhere.example/thanks");
    expect(((await (await check(t, key, site.id, ["payment"])).json()) as SiteView).checks.payment!.ok).toBe(false);
    await pay(t, id, "https://shop.example.com/thanks");
    const done = (await (await check(t, key, site.id, ["payment"])).json()) as SiteView;
    expect(done.checks.payment).toMatchObject({ ok: true });
    expect(done.checks.payment!.detail).toContain("2026-11-06");
  });
  it("does not count another business's paid invoice", async () => {
    const { t } = world();
    const a = await seedMerchant(t.db, "m_1", "Acme", A);
    await seedMerchant(t.db, "m_2", "Beta", B);
    const site = await registered(t, a);
    await pay(t, await seedInvoice(t.db, "INV-9", 1_000_000n, "m_2"), "https://shop.example.com/thanks", "paid", "m_2");
    expect(((await (await check(t, a, site.id, ["payment"])).json()) as SiteView).checks.payment!.ok).toBe(false);
  });
  it("moves no money: checking never creates an invoice or calls the chain", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    await check(t, key, site.id);
    expect(t.chain.calls).toHaveLength(0);
    expect(await t.db.prepare("select count(*) as n from invoices").first("n")).toBe(0);
  });
});

describe("running all checks", () => {
  it("is ready only when all four pass, and reports each with its own time", async () => {
    const { t, net } = world();
    const key = await seedMerchant(t.db);
    await seedEndpoint(t.db, { url: "https://shop.example.com/webhooks/stenmont" });
    net.sites["shop.example.com"] = () => new Response("ok");
    const site = await registered(t, key);
    net.txt[site.verification.recordName] = [site.verification.recordValue];
    const partial = (await (await check(t, key, site.id)).json()) as SiteView;
    expect(partial.ready).toBe(false);
    expect(Object.values(partial.checks).filter((c) => c?.ok)).toHaveLength(3);
    const id = await seedInvoice(t.db);
    await t.db.prepare("update invoices set status='paid', success_url='https://shop.example.com/thanks' where id = ?").bind(id).run();
    const full = (await (await check(t, key, site.id)).json()) as SiteView;
    expect(full.ready).toBe(true);
    expect((await (await t.req(`/v1/sites/${site.id}`, { key })).json()) as SiteView).toMatchObject({ ready: true });
  });
  it("rejects an unknown check name and limits how often checks can run", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    expect((await check(t, key, site.id, ["everything"])).status).toBe(400);
    let last = 200;
    for (let i = 0; i < 13; i++) last = (await check(t, key, site.id, ["domain"])).status;
    expect(last).toBe(429);
  });
  it("a deleted site is gone along with its results", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const site = await registered(t, key);
    await check(t, key, site.id, ["reachable"]);
    expect((await t.req(`/v1/sites/${site.id}`, { method: "DELETE", key })).status).toBe(204);
    expect((await t.req(`/v1/sites/${site.id}`, { key })).status).toBe(404);
    expect(await t.db.prepare("select count(*) as n from site_checks").first("n")).toBe(0);
  });
});

describe("live / paused switch", () => {
  const make = (t: T, key: string, number: string) =>
    t.req("/v1/invoices", { method: "POST", key, idem: crypto.randomUUID(), body: json({ amount: "5.00", number }) });
  const setSwitch = (t: T, key: string, body: unknown) => t.req("/v1/payment-switch", { method: "POST", key, body: json(body) });

  it("starts live in test mode", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    expect(await (await t.req("/v1/payment-switch", { key })).json()).toEqual({ paused: false, mode: "test", updatedAt: null });
  });
  it("while paused, creating an invoice or a checkout session answers 403 payments_paused and touches nothing", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    expect((await make(t, key, "INV-1")).status).toBe(201);
    const paused = await setSwitch(t, key, { paused: true });
    expect(await paused.json()).toMatchObject({ paused: true, mode: "test" });
    const calls = t.chain.calls.length;
    const res = await make(t, key, "INV-2");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payments_paused");
    const session = await t.req("/v1/invoices", { method: "POST", key, idem: crypto.randomUUID(), body: json({ amount: "5.00", successUrl: "https://shop.example.com/ok", cancelUrl: "https://shop.example.com" }) });
    expect(session.status).toBe(403);
    expect(t.chain.calls.length).toBe(calls);
    expect(await t.db.prepare("select count(*) as n from invoices").first("n")).toBe(1);
  });
  it("resuming lets invoices through again", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    await setSwitch(t, key, { paused: true });
    await setSwitch(t, key, { paused: false });
    expect((await make(t, key, "INV-1")).status).toBe(201);
  });
  it("pausing one business does not affect another", async () => {
    const { t } = world();
    const a = await seedMerchant(t.db, "m_1", "Acme", A);
    const b = await seedMerchant(t.db, "m_2", "Beta", B);
    await setSwitch(t, a, { paused: true });
    expect((await make(t, b, "INV-1")).status).toBe(201);
    expect(await (await t.req("/v1/payment-switch", { key: b })).json()).toMatchObject({ paused: false });
  });
  it("the pay page data says so, and the relay refuses a payment, for an invoice created before the pause", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    const inv = (await (await make(t, key, "INV-1")).json()) as { id: string };
    expect(await (await t.req(`/pay/${inv.id}`)).json()).toMatchObject({ paused: false });
    await setSwitch(t, key, { paused: true });
    expect(await (await t.req(`/pay/${inv.id}`)).json()).toMatchObject({ paused: true, status: "open" });
    const relay = await t.req("/relay/pay", {
      method: "POST",
      body: json({ invoiceId: inv.id, value: "5", payer: "0x" + "22".repeat(20), validAfter: "0", validBefore: "9999999999", salt: "0x" + "00".repeat(32), signature: "0x" + "11".repeat(65) }),
    });
    expect(relay.status).toBe(403);
    expect(((await relay.json()) as { error: { code: string } }).error.code).toBe("payments_paused");
    expect(t.chain.sent).toHaveLength(0);
  });
  it("stores the test or live label and nothing else about it, and refuses other values", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    expect(await (await setSwitch(t, key, { mode: "live" })).json()).toMatchObject({ mode: "live", paused: false });
    expect(await (await t.req("/v1/payment-switch", { key })).json()).toMatchObject({ mode: "live" });
    expect((await setSwitch(t, key, { mode: "mainnet" })).status).toBe(400);
    expect((await setSwitch(t, key, {})).status).toBe(400);
    expect((await setSwitch(t, key, { paused: "yes" })).status).toBe(400);
  });
  it("is written to the audit log", async () => {
    const { t } = world();
    const key = await seedMerchant(t.db);
    await setSwitch(t, key, { paused: true });
    const rows = (await t.db.prepare("select action from audit_log where action like 'payments.%'").all()).results as { action: string }[];
    expect(rows.map((r) => r.action)).toEqual(["payments.paused"]);
  });
});
