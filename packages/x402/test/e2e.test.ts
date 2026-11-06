import { describe, expect, it } from "vitest";
import { verifyTypedData, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Hono } from "hono";
import { createApp } from "../../../services/facilitator/src/index";
import { MemoryStore } from "../../../services/facilitator/src/store";
import { MemoryCounters, MemoryPayees } from "../../../services/facilitator/src/guard";
import { stenmontPaywall } from "../src";
import { LimitExceeded, createAgentFetch } from "../../agent/src";

const payTo: Address = "0x00000000000000000000000000000000000000aa";
const NOW = new Date("2026-11-06T10:00:00Z");

function world() {
  const sent: Hex[] = [];
  const chain = {
    verifySignature: async (a: any) => verifyTypedData({ address: a.address, ...a.typedData, signature: a.signature }),
    usdtBalance: async () => 10n ** 9n,
    authorizationUsed: async () => false,
    simulateTransfer: async () => {},
    facilitatorBalance: async () => 10n ** 18n,
    estimateCost: async () => 10n ** 15n,
    send: async () => { sent.push(("0x" + String(sent.length + 1).padStart(64, "0")) as Hex); return sent.at(-1)!; },
    waitForReceipt: async () => ({ status: "success" as const }),
  };
  const facilitator = createApp({ chain, store: new MemoryStore(), now: () => Math.floor(NOW.getTime() / 1000), minWbtWei: 1n, payees: new MemoryPayees([payTo]), counters: new MemoryCounters() });
  let handlerRuns = 0;
  const merchant = new Hono();
  merchant.get("/premium", stenmontPaywall({ amount: "0.50", payTo, facilitatorUrl: "http://facilitator", fetch: ((u: any, i: any) => facilitator.request(new URL(u).pathname, i)) as any }), (c: any) => { handlerRuns++; return c.json({ report: "q3" }); });
  const net = ((input: any, init: any) => merchant.fetch(input instanceof Request ? input : new Request(input, init))) as typeof fetch;
  return { sent, net, runs: () => handlerRuns };
}

describe("agent -> paywall -> facilitator", () => {
  it("pays once, runs the handler once, settles once; an over-limit request is refused client-side", async () => {
    const w = world();
    const agent = createAgentFetch({ account: privateKeyToAccount(generatePrivateKey()), maxPerRequest: "1.00", dailyLimit: "1.00", allowedHosts: ["merchant.test"], fetch: w.net, now: () => NOW });
    const res = await agent("https://merchant.test/premium");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: "q3" });
    expect(w.runs()).toBe(1);
    expect(w.sent).toHaveLength(1);
    expect(JSON.parse(atob(res.headers.get("PAYMENT-RESPONSE")!)).transaction).toBe(w.sent[0]);

    expect((await agent("https://merchant.test/premium")).status).toBe(200); // 0.50 + 0.50 = 1.00, at the limit
    await expect(agent("https://merchant.test/premium")).rejects.toBeInstanceOf(LimitExceeded);
    expect(w.sent).toHaveLength(2);
    expect(w.runs()).toBe(2);
  });

  it("a replayed payment header gets no content", async () => {
    const w = world();
    let header = "";
    const spy = ((input: any, init: any) => { const r = new Request(input, init); header = r.headers.get("PAYMENT-SIGNATURE") || header; return w.net(r); }) as typeof fetch;
    const agent = createAgentFetch({ account: privateKeyToAccount(generatePrivateKey()), maxPerRequest: "1", dailyLimit: "10", fetch: spy, now: () => NOW });
    await agent("https://merchant.test/premium");
    const replay = await w.net(new Request("https://merchant.test/premium", { headers: { "PAYMENT-SIGNATURE": header } }));
    expect(replay.status).toBe(402);
    expect(await replay.text()).not.toContain("q3");
    expect(w.sent).toHaveLength(1);
  });
});
