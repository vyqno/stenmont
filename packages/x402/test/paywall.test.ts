import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { USDT_ADDRESS } from "@stenmont/shared";
import { stenmontPaywall } from "../src";

const payTo = "0x00000000000000000000000000000000000000aa";
const b64 = (o: unknown) => btoa(JSON.stringify(o));
const unb64 = (s: string) => JSON.parse(atob(s));
const paid = { "PAYMENT-SIGNATURE": b64({ x402Version: 2, accepted: {}, payload: { signature: "0x01" } }) };

function setup(facilitator: (path: string, body: any) => Response | Promise<Response>, extra: Partial<Parameters<typeof stenmontPaywall>[0]> = {}) {
  const calls: string[] = [];
  const fetchFn = (async (url: string, init: any) => {
    const path = new URL(url).pathname;
    calls.push(path);
    return facilitator(path, JSON.parse(init.body));
  }) as unknown as typeof fetch;
  const handler = vi.fn((c: any) => c.json({ secret: "data" }));
  const app = new Hono();
  app.get("/premium", stenmontPaywall({ amount: "0.01", payTo, facilitatorUrl: "https://f.test", fetch: fetchFn, ...extra }), handler);
  return { app, calls, handler };
}
const ok = (path: string) => Response.json(path === "/verify" ? { isValid: true } : { success: true, transaction: "0xabc", network: "eip155:1874", payer: "0x1" });

describe("stenmontPaywall", () => {
  it("answers 402 with the server's requirements, in body and header", async () => {
    const { app, calls, handler } = setup(ok);
    const res = await app.request("/premium");
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(unb64(res.headers.get("PAYMENT-REQUIRED")!)).toEqual(body);
    expect(body.accepts).toEqual([{ scheme: "exact", network: "eip155:1874", asset: USDT_ADDRESS, amount: "10000", payTo, maxTimeoutSeconds: 60, extra: { name: "Tether USD", version: "1" } }]);
    expect(calls).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("valid payment: 200, handler once, settle once, PAYMENT-RESPONSE", async () => {
    const { app, calls, handler } = setup(ok);
    const res = await app.request("/premium", { headers: paid });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ secret: "data" });
    expect(calls).toEqual(["/verify", "/settle"]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(unb64(res.headers.get("PAYMENT-RESPONSE")!)).toMatchObject({ success: true, transaction: "0xabc" });
  });

  it("accepts the legacy X-PAYMENT header too", async () => {
    const { app } = setup(ok);
    expect((await app.request("/premium", { headers: { "X-PAYMENT": paid["PAYMENT-SIGNATURE"] } })).status).toBe(200);
  });

  it("invalid payment: 402 with the reason, handler not run, no settle", async () => {
    const { app, calls, handler } = setup((p) => Response.json({ isValid: false, invalidReason: "insufficient_funds" }));
    const res = await app.request("/premium", { headers: paid });
    expect(res.status).toBe(402);
    expect(((await res.json()) as any).error).toBe("insufficient_funds");
    expect(calls).toEqual(["/verify"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("garbage header: 402, facilitator never called", async () => {
    const { app, calls } = setup(ok);
    const res = await app.request("/premium", { headers: { "PAYMENT-SIGNATURE": "%%%" } });
    expect(res.status).toBe(402);
    expect(calls).toEqual([]);
  });

  it("facilitator down at verify: 502, nothing leaked", async () => {
    const { app, handler } = setup(() => { throw new Error("boom"); });
    const res = await app.request("/premium", { headers: paid });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret");
    expect(handler).not.toHaveBeenCalled();
  });

  it("settle fails (e.g. replay): content withheld, 402 with the reason", async () => {
    const { app } = setup((p) => (p === "/verify" ? Response.json({ isValid: true }) : Response.json({ success: false, errorReason: "duplicate_settlement" })));
    const res = await app.request("/premium", { headers: paid });
    expect(res.status).toBe(402);
    const text = await res.text();
    expect(text).toContain("duplicate_settlement");
    expect(text).not.toContain("secret");
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeNull();
  });

  it("facilitator dies between verify and settle: 502, content withheld", async () => {
    const { app } = setup((p) => { if (p === "/verify") return Response.json({ isValid: true }); throw new Error("down"); });
    const res = await app.request("/premium", { headers: paid });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret");
  });

  it("a failing handler is not charged", async () => {
    const calls: string[] = [];
    const app = new Hono();
    app.get("/x", stenmontPaywall({ amount: "1", payTo, facilitatorUrl: "https://f.test", fetch: (async (u: string) => { calls.push(new URL(u).pathname); return ok(new URL(u).pathname); }) as any }), (c) => c.json({ e: 1 }, 500));
    expect((await app.request("/x", { headers: paid })).status).toBe(500);
    expect(calls).toEqual(["/verify"]);
  });

  it("never trusts a requirement forged by the client", async () => {
    let sent: any;
    const { app } = setup((p, body) => { sent = body; return ok(p); });
    const forged = b64({ x402Version: 2, accepted: { scheme: "exact", network: "eip155:1", asset: "0xdead", amount: "1", payTo: "0xbeef" }, paymentRequirements: { amount: "1" }, payload: {} });
    await app.request("/premium", { headers: { "PAYMENT-SIGNATURE": forged } });
    expect(sent.paymentRequirements).toMatchObject({ network: "eip155:1874", asset: USDT_ADDRESS, amount: "10000", payTo });
  });

  it("resolves an ENS payTo through the injected resolver", async () => {
    const resolveName = vi.fn(async () => payTo);
    const { app } = setup(ok, { payTo: "shop.stenmont.eth", resolveName });
    const body = (await (await app.request("/premium")).json()) as any;
    expect(body.accepts[0].payTo).toBe(payTo);
    await app.request("/premium");
    expect(resolveName).toHaveBeenCalledTimes(1);
  });

  it("a name without a resolver fails closed", async () => {
    const { app } = setup(ok, { payTo: "shop.stenmont.eth" });
    expect((await app.request("/premium")).status).toBe(500);
  });

  it("rejects a bad price at construction", () => {
    expect(() => stenmontPaywall({ amount: "-1", payTo, facilitatorUrl: "x" })).toThrow();
  });
});
