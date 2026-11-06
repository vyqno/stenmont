import { describe, expect, it } from "vitest";
import { createApp } from "../src";
import { makeShopify } from "../src/shopify";
import { tokenProvider, webhookSecret } from "../src/token";
import { deps, env, fake, memoryKv, SHOP, type Call } from "./helpers";

const CID = fake("client_id");
const CSECRET = fake("client_secret");
const creds = (over: object = {}) => env({ SHOPIFY_ADMIN_TOKEN: "", SHOPIFY_CLIENT_ID: CID, SHOPIFY_CLIENT_SECRET: CSECRET, SHOPIFY_WEBHOOK_SECRET: "", STATE: memoryKv(), ...over });
const isToken = (c: Call) => c.url === `https://${SHOP}/admin/oauth/access_token`;

/** A pretend Shopify: hands out numbered tokens and accepts only the newest one. */
function shop(opts: { tokenStatus?: number; tokenBody?: string; expiresIn?: number } = {}) {
  const calls: Call[] = [];
  const st = { issued: 0, valid: new Set<string>() };
  let clock = 1_800_000_000_000;
  const d = deps((c) => {
    if (isToken(c)) {
      if (opts.tokenStatus) return new Response(opts.tokenBody ?? "", { status: opts.tokenStatus });
      const t = `tok_${++st.issued}`;
      st.valid.add(t);
      return Response.json({ access_token: t, scope: "read_orders", expires_in: opts.expiresIn ?? 86399 });
    }
    return st.valid.has(c.headers.get("x-shopify-access-token") ?? "") ? Response.json({ data: { ok: true } }) : new Response("no", { status: 401 });
  }, calls);
  d.now = () => clock;
  return { calls, st, d, advance: (ms: number) => (clock += ms) };
}
const client = (e: ReturnType<typeof env>, d: ReturnType<typeof deps>) => makeShopify({ shop: SHOP, token: tokenProvider(e, d), fetch: d.fetch, sleep: d.sleep });

describe("Shopify token provider (client credentials grant)", () => {
  it("fetches a token with a form-encoded client_credentials request, and sends it only to the shop's admin API", async () => {
    const s = shop();
    expect(await client(creds(), s.d).gql("q")).toEqual({ ok: true });
    const t = s.calls.find(isToken)!;
    expect(t.method).toBe("POST");
    expect(t.redirect).toBe("manual");
    expect(t.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(t.body as string).get("grant_type")).toBe("client_credentials");
    expect(new URLSearchParams(t.body as string).get("client_id")).toBe(CID);
    expect(new URLSearchParams(t.body as string).get("client_secret")).toBe(CSECRET);
    expect(new URLSearchParams(t.body as string).has("scope")).toBe(false);
    for (const c of s.calls) expect(c.url.startsWith(`https://${SHOP}/admin/`)).toBe(true);
    expect(s.calls.find((c) => !isToken(c))!.headers.get("x-shopify-access-token")).toBe("tok_1");
  });

  it("uses the cached token until 5 minutes before it expires, then refreshes", async () => {
    const s = shop();
    const e = creds();
    await client(e, s.d).gql("q");
    await client(e, s.d).gql("q"); // a new client (new request) still hits the KV cache
    expect(s.st.issued).toBe(1);
    s.advance((86399 - 5 * 60) * 1000 - 1000); // just inside the margin
    await client(e, s.d).gql("q");
    expect(s.st.issued).toBe(1);
    s.advance(2000); // past expiry minus 5 minutes
    await client(e, s.d).gql("q");
    expect(s.st.issued).toBe(2);
    expect(s.calls.filter((c) => !isToken(c)).at(-1)!.headers.get("x-shopify-access-token")).toBe("tok_2");
  });

  it("on a 401 gets a fresh token and retries exactly once", async () => {
    const s = shop();
    const e = creds();
    await client(e, s.d).gql("q");
    s.st.valid.clear(); // Shopify revoked it
    expect(await client(e, s.d).gql("q")).toEqual({ ok: true });
    expect(s.st.issued).toBe(2);
    // a second 401 after the refresh is an error, not a loop
    const bad = { ...s.d, fetch: (async (u: any, i: any) => (String(u).includes("/graphql") ? new Response("no", { status: 401 }) : s.d.fetch(u, i))) as typeof fetch };
    expect(((await client(creds(), bad).gql("q").catch((x) => x)) as any).code).toBe("shopify_denied");
  });

  it("shares one refresh between concurrent requests", async () => {
    const s = shop();
    const e = creds();
    const results = await Promise.all(Array.from({ length: 8 }, () => client(e, s.d).gql("q")));
    expect(results.every((r: any) => r.ok)).toBe(true);
    expect(s.st.issued).toBe(1);
  });

  it("maps shop_not_permitted and invalid_client to operator error codes without leaking secrets", async () => {
    const a: any = await client(creds(), shop({ tokenStatus: 400, tokenBody: '{"error":"shop_not_permitted","error_description":"Oauth error shop_not_permitted: Client credentials cannot be performed on this shop."}' }).d).gql("q").catch((x) => x);
    expect(a.code).toBe("shopify_shop_not_permitted");
    const b: any = await client(creds(), shop({ tokenStatus: 400, tokenBody: '{"error":"invalid_client"}' }).d).gql("q").catch((x) => x);
    expect(b.code).toBe("shopify_invalid_client");
    const c: any = await client(creds(), shop({ tokenStatus: 500 }).d).gql("q").catch((x) => x);
    expect(c.code).toBe("shopify_token_error");
    for (const x of [a, b, c]) {
      expect(x.message).not.toContain(CSECRET);
      expect(x.message).not.toContain(CID);
    }
  });

  it("surfaces the error code through the HTTP API", async () => {
    const s = shop({ tokenStatus: 403, tokenBody: "shop_not_permitted" });
    const res = await createApp(s.d).request("/admin/register-webhooks", { method: "POST", headers: { authorization: `Bearer ${fake("bridge_admin")}` } }, creds());
    expect(res.status).toBe(422); // plain http is refused before anything is called
    const r2 = await createApp(s.d).request("https://bridge.example.com/admin/register-webhooks", { method: "POST", headers: { authorization: `Bearer ${fake("bridge_admin")}` } }, creds({ BRIDGE_ADMIN_TOKEN: fake("bridge_admin") }));
    expect(r2.status).toBe(502);
    const text = await r2.text();
    expect(JSON.parse(text).error.code).toBe("shopify_shop_not_permitted");
    expect(text).not.toContain(CSECRET);
  });

  it("never stores the token anywhere but KV and never returns it", async () => {
    const s = shop();
    const e = creds();
    const res = await client(e, s.d).gql("q");
    expect(JSON.stringify(res)).not.toContain("tok_");
    expect(JSON.parse((e.STATE as any).m.get("shopify:token")).token).toBe("tok_1");
  });

  it("override: SHOPIFY_ADMIN_TOKEN is used as is, no token request, and a 401 is not retried", async () => {
    const calls: Call[] = [];
    const d = deps(() => new Response("no", { status: 401 }), calls);
    const e = env({ SHOPIFY_ADMIN_TOKEN: fake("legacy"), SHOPIFY_CLIENT_ID: CID, SHOPIFY_CLIENT_SECRET: CSECRET });
    expect(((await client(e, d).gql("q").catch((x) => x)) as any).code).toBe("shopify_denied");
    expect(calls.length).toBe(1);
    expect(calls[0]!.headers.get("x-shopify-access-token")).toBe(fake("legacy"));
    expect(calls.some(isToken)).toBe(false);
  });

  it("needs client id and secret when there is no override", () => {
    expect(() => tokenProvider(creds({ SHOPIFY_CLIENT_ID: "" }), shop().d)).toThrow(/SHOPIFY_CLIENT_ID/);
  });

  it("webhooks are verified with the client secret unless a webhook secret is set", async () => {
    expect(webhookSecret({ SHOPIFY_CLIENT_SECRET: "c" })).toBe("c");
    expect(webhookSecret({ SHOPIFY_CLIENT_SECRET: "c", SHOPIFY_WEBHOOK_SECRET: "w" })).toBe("w");
    expect(webhookSecret({})).toBe("");
    // end to end: a webhook signed with the client secret is accepted when SHOPIFY_WEBHOOK_SECRET is unset
    const raw = JSON.stringify({ id: 1, admin_graphql_api_id: "gid://shopify/Order/1", name: "#1", total_price: "1.00", currency: "USD", financial_status: "paid", payment_gateway_names: [] });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(CSECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))));
    const res = await createApp(shop().d).request("/webhooks/shopify", { method: "POST", headers: { "x-shopify-hmac-sha256": sig, "x-shopify-topic": "orders/paid", "x-shopify-shop-domain": SHOP }, body: raw }, creds());
    expect(res.status).toBe(200);
  });
});
