import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { LIMITS_KEY, PAY_KEY, REFUND_KEY, TOKEN_KEY, USDT_ADDRESS, X402_KEY, limitsRecord, toUnits, tokenRecord } from "@stenmont/shared";
import { parseArgs, payByName } from "./agent-pays-by-name-lib";

const account = privateKeyToAccount(generatePrivateKey());
const records: Record<string, string> = {
  [PAY_KEY]: "https://pay.acme.example/c",
  [X402_KEY]: "https://api.acme.example/premium",
  [TOKEN_KEY]: tokenRecord(),
  [LIMITS_KEY]: limitsRecord(toUnits("5")),
  [REFUND_KEY]: "14 days",
};
const read = async (_n: string, k: string) => records[k] ?? null;
const b64 = (o: unknown) => btoa(JSON.stringify(o));
const requirement = (amount: string) => ({ scheme: "exact", network: "eip155:1874", asset: USDT_ADDRESS, amount, payTo: "0x00000000000000000000000000000000000000aa", maxTimeoutSeconds: 60, extra: { name: "Tether USD", version: "1" } });
function shop(amount = "10000") {
  const seen: Request[] = [];
  const f = (async (input: any) => {
    const r = input as Request;
    seen.push(r);
    return r.headers.has("PAYMENT-SIGNATURE")
      ? new Response("quote: 42", { headers: { "PAYMENT-RESPONSE": b64({ success: true, transaction: "0xabc" }) } })
      : new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": b64({ accepts: [requirement(amount)] }) } });
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe("parseArgs", () => {
  it("takes a name and sensible default limits", () => {
    expect(parseArgs(["acme.stenmont.eth"])).toEqual({ name: "acme.stenmont.eth", maxPerRequest: "0.05", dailyLimit: "1.00", path: "" });
  });
  it("reads the options", () => {
    expect(parseArgs(["a.eth", "--max-per-request", "0.2", "--daily", "2", "--path", "/q"])).toMatchObject({ maxPerRequest: "0.2", dailyLimit: "2", path: "/q" });
  });
  it("refuses a missing name, unknown options, bad amounts and off-host paths", () => {
    for (const bad of [[], ["a.eth", "b.eth"], ["a.eth", "--nope"], ["a.eth", "--daily"], ["a.eth", "--daily", "abc"], ["a.eth", "--max-per-request", "-1"], ["a.eth", "--path", "x"], ["a.eth", "--path", "/a b"]]) expect(() => parseArgs(bad)).toThrow();
  });
});

describe("payByName", () => {
  it("resolves the name, calls only its endpoint and pays within its limits", async () => {
    const s = shop();
    const r = await payByName(parseArgs(["acme.stenmont.eth"]), { read, account, fetch: s.f });
    expect(r).toMatchObject({ ok: true, status: 200, body: "quote: 42", url: "https://api.acme.example/premium" });
    expect(s.seen.every((q) => new URL(q.url).hostname === "api.acme.example")).toBe(true);
    expect(s.seen).toHaveLength(2);
  });
  it("keeps the path on the business's host", async () => {
    const s = shop();
    const r = await payByName(parseArgs(["acme.stenmont.eth", "--path", "/other"]), { read, account, fetch: s.f });
    expect(r).toMatchObject({ ok: true, url: "https://api.acme.example/other" });
  });
  it("refuses a price above the agent's own per-request limit before signing", async () => {
    const s = shop("100000"); // 0.10 USDT against 0.05
    const r = await payByName(parseArgs(["acme.stenmont.eth"]), { read, account, fetch: s.f });
    expect(r).toMatchObject({ ok: false, stage: "limits" });
    expect(s.seen.some((q) => q.headers.has("PAYMENT-SIGNATURE"))).toBe(false);
  });
  it("refuses a price above the cap the business itself published", async () => {
    const s = shop(String(toUnits("6")));
    const r = await payByName(parseArgs(["acme.stenmont.eth", "--max-per-request", "100", "--daily", "100"]), { read, account, fetch: s.f });
    expect(r).toMatchObject({ ok: false, stage: "limits" });
    expect(s.seen.some((q) => q.headers.has("PAYMENT-SIGNATURE"))).toBe(false);
  });
  it("makes no request at all when the directory is wrong", async () => {
    const s = shop();
    for (const bad of <Record<string, string>[]>[{ ...records, [TOKEN_KEY]: tokenRecord(1874, "0x0000000000000000000000000000000000000001") }, { ...records, [X402_KEY]: "http://api.acme.example/premium" }, { ...records, [PAY_KEY]: "" }]) {
      const r = await payByName(parseArgs(["acme.stenmont.eth"]), { read: async (_n, k) => bad[k] ?? null, account, fetch: s.f });
      expect(r).toMatchObject({ ok: false, stage: "directory" });
    }
    expect(s.seen).toHaveLength(0);
  });
  it("refuses a business with no x402 endpoint", async () => {
    const s = shop();
    const r = await payByName(parseArgs(["acme.stenmont.eth"]), { read: async (_n, k) => (k === X402_KEY ? null : (records[k] ?? null)), account, fetch: s.f });
    expect(r).toMatchObject({ ok: false, stage: "directory" });
    expect(s.seen).toHaveLength(0);
  });
});
