import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, buildTransferAuth } from "@stenmont/shared";
import { LimitExceeded, MemoryLedger, createAgentFetch } from "../src";

const account = privateKeyToAccount(generatePrivateKey());
const payTo = "0x00000000000000000000000000000000000000aa";
const T0 = new Date("2026-11-06T10:00:00Z");
const b64 = (o: unknown) => btoa(JSON.stringify(o));
const unb64 = (s: string) => JSON.parse(atob(s));

const req = (over: any = {}) => ({ scheme: "exact", network: "eip155:1874", asset: USDT_ADDRESS, amount: "10000", payTo, maxTimeoutSeconds: 60, extra: { name: "Tether USD", version: "1" }, ...over });
const challenge = (r: any) => new Response(JSON.stringify({ x402Version: 2, accepts: [r] }), { status: 402, headers: { "PAYMENT-REQUIRED": b64({ accepts: [r] }) } });

function server(r: any, after: () => Response = () => new Response("ok", { headers: { "PAYMENT-RESPONSE": b64({ success: true }) } })) {
  const seen: Request[] = [];
  const f = (async (input: any) => {
    const rq = input as Request;
    seen.push(rq);
    return rq.headers.has("PAYMENT-SIGNATURE") ? after() : challenge(r);
  }) as unknown as typeof fetch;
  return { f, seen };
}
const agent = (f: typeof fetch, o: any = {}) => createAgentFetch({ account, maxPerRequest: "1.00", dailyLimit: "100", fetch: f, now: () => T0, ...o });

describe("createAgentFetch", () => {
  it("pays a 0.01 endpoint once, with a signature that recovers to the account", async () => {
    const { f, seen } = server(req());
    const res = await agent(f)("https://api.test/x");
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(2);
    const p = unb64(seen[1]!.headers.get("PAYMENT-SIGNATURE")!);
    const a = p.payload.authorization;
    expect(a).toMatchObject({ from: account.address, to: payTo, value: "10000", validAfter: "0", validBefore: String(Math.floor(T0.getTime() / 1000) + 60) });
    expect(a.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(p.accepted).toEqual(req());
    const typed = buildTransferAuth({ from: a.from, to: a.to, value: BigInt(a.value), validAfter: 0n, validBefore: BigInt(a.validBefore), nonce: a.nonce });
    expect(await recoverTypedDataAddress({ ...typed, signature: p.payload.signature })).toBe(account.address);
  });

  it("passes non-402 responses through untouched", async () => {
    const f = (async () => new Response("free")) as unknown as typeof fetch;
    expect(await (await agent(f)("https://api.test/x")).text()).toBe("free");
  });

  it("refuses 5.00 when maxPerRequest is 1.00, before signing", async () => {
    const { f, seen } = server(req({ amount: "5000000" }));
    await expect(agent(f)("https://api.test/x")).rejects.toMatchObject({ name: "LimitExceeded", reason: "per_request" });
    expect(seen).toHaveLength(1);
  });

  it("refuses the 101st 1.00 payment when dailyLimit is 100", async () => {
    const { f } = server(req({ amount: "1000000" }));
    const a = agent(f);
    for (let i = 0; i < 100; i++) expect((await a("https://api.test/x")).status).toBe(200);
    await expect(a("https://api.test/x")).rejects.toMatchObject({ reason: "daily" });
  });

  it("resets the limit on the next UTC day", async () => {
    const { f } = server(req({ amount: "1000000" }));
    let t = T0;
    const a = agent(f, { dailyLimit: "1", now: () => t });
    await a("https://api.test/x");
    await expect(a("https://api.test/x")).rejects.toBeInstanceOf(LimitExceeded);
    t = new Date("2026-11-07T00:00:01Z");
    expect((await a("https://api.test/x")).status).toBe(200);
  });

  it("refuses a host that is not allowed", async () => {
    const { f, seen } = server(req());
    const a = agent(f, { allowedHosts: ["api.good.test"] });
    await expect(a("https://evil.test/x")).rejects.toMatchObject({ reason: "host_not_allowed" });
    expect(seen).toHaveLength(1);
    expect((await a("https://API.good.test/x")).status).toBe(200);
  });

  it("refuses the wrong asset and the wrong network", async () => {
    await expect(agent(server(req({ asset: "0x00000000000000000000000000000000000000cc" })).f)("https://a.test")).rejects.toMatchObject({ reason: "wrong_asset" });
    await expect(agent(server(req({ network: "eip155:1" })).f)("https://a.test")).rejects.toMatchObject({ reason: "wrong_network" });
  });

  it("refuses unusable requirements", async () => {
    await expect(agent(server(req({ amount: "0" })).f)("https://a.test")).rejects.toMatchObject({ reason: "bad_requirements" });
    await expect(agent(server(req({ payTo: "nope" })).f)("https://a.test")).rejects.toMatchObject({ reason: "bad_requirements" });
  });

  it("retries at most once: a 402 after paying is returned and does not count", async () => {
    const { f, seen } = server(req({ amount: "1000000" }), () => challenge(req({ amount: "1000000" })));
    const ledger = new MemoryLedger();
    const res = await agent(f, { ledger })("https://api.test/x");
    expect(res.status).toBe(402);
    expect(seen).toHaveLength(2);
    expect(ledger.spent("2026-11-06")).toBe(0n);
  });

  it("a failed retry does not eat the daily limit", async () => {
    const { f } = server(req({ amount: "1000000" }), () => new Response("x", { status: 500 }));
    const a = agent(f, { dailyLimit: "1" });
    for (let i = 0; i < 3; i++) expect((await a("https://api.test/x")).status).toBe(500);
  });

  it("parallel payments cannot overspend the day", async () => {
    const { f } = server(req({ amount: "1000000" }));
    const a = agent(f, { dailyLimit: "2" });
    const r = await Promise.allSettled([1, 2, 3, 4].map(() => a("https://api.test/x")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(2);
  });

  it("caps how long a signed authorization can live", async () => {
    const { f, seen } = server(req({ maxTimeoutSeconds: 999999 }));
    await agent(f)("https://api.test/x");
    const a = unb64(seen[1]!.headers.get("PAYMENT-SIGNATURE")!).payload.authorization;
    expect(Number(a.validBefore) - Math.floor(T0.getTime() / 1000)).toBe(600);
  });

  it("preserves method and body on the paid retry", async () => {
    const { f, seen } = server(req());
    await agent(f)("https://api.test/x", { method: "POST", body: "hello" });
    expect(seen[1]!.method).toBe("POST");
    expect(await seen[1]!.text()).toBe("hello");
  });
});
