import { describe, expect, it } from "vitest";
import { toUnits } from "@stenmont/shared";
import { windowStartBlock } from "../../src/ens/agentSpend";
import { seedMerchant, setup } from "../helpers/app";

describe("windowStartBlock", () => {
  it("goes back as many blocks as the window holds at the measured block time", () => {
    // 2 seconds a block: a day is 43,200 blocks
    expect(windowStartBlock({ latest: { number: 100_000n, timestamp: 1_000_000n }, sample: { number: 99_000n, timestamp: 998_000n }, windowSeconds: 86_400, maxBlocks: 500_000n })).toBe(100_000n - 43_200n);
  });
  it("never goes below block zero or further than the cap", () => {
    expect(windowStartBlock({ latest: { number: 1_000n, timestamp: 2_000n }, sample: { number: 0n, timestamp: 0n }, windowSeconds: 86_400, maxBlocks: 500_000n })).toBe(0n);
    expect(windowStartBlock({ latest: { number: 1_000_000n, timestamp: 2_000_000n }, sample: { number: 999_000n, timestamp: 1_999_000n }, windowSeconds: 86_400, maxBlocks: 50_000n })).toBe(950_000n);
  });
  it("falls back to the cap when the block time cannot be measured", () => {
    expect(windowStartBlock({ latest: { number: 10_000n, timestamp: 5n }, sample: { number: 10_000n, timestamp: 5n }, windowSeconds: 86_400, maxBlocks: 3_000n })).toBe(7_000n);
    expect(windowStartBlock({ latest: { number: 10_000n, timestamp: 5n }, sample: { number: 9_000n, timestamp: 9n }, windowSeconds: 86_400, maxBlocks: 3_000n })).toBe(7_000n);
  });
});

const AGENT = "0x8888888888888888888888888888888888888888";
const OTHER = "0x9999999999999999999999999999999999999999";
async function world(sent: Record<string, bigint | Error> = {}) {
  const asked: { from: string; seconds: number }[] = [];
  const t = setup({
    async usdtSentSince(from, seconds) {
      asked.push({ from: from.toLowerCase(), seconds });
      const v = sent[from.toLowerCase()] ?? 0n;
      if (v instanceof Error) throw v;
      return v;
    },
  });
  const key = await seedMerchant(t.db);
  await t.req("/v1/ens/claim-name", { method: "POST", key, idem: "c1", body: JSON.stringify({ label: "acme" }) });
  const create = (label: string, agentAddress: string) =>
    t.req("/v1/ens/agents", { method: "POST", key, idem: crypto.randomUUID(), body: JSON.stringify({ label, agentAddress, scopes: ["pay"], dailyLimit: "50", perTxLimit: "10", expiresInDays: 30 }) });
  return { t, key, create, asked };
}
const spend = async (t: ReturnType<typeof setup>, key: string) => ({ status: 0, ...((await (await t.req("/v1/ens/agents/spend", { key })).json()) as any) });

describe("GET /v1/ens/agents/spend", () => {
  it("reports what each agent's address sent in the last 24 hours", async () => {
    const { t, key, create, asked } = await world({ [AGENT]: toUnits("12.5") });
    await create("billing-bot", AGENT);
    expect(await spend(t, key)).toMatchObject({ windowHours: 24, data: [{ label: "billing-bot", spent: "12.5" }] });
    expect(asked).toEqual([{ from: AGENT, seconds: 86_400 }]);
  });
  it("says null, not zero, when the amount could not be read", async () => {
    const { t, key, create } = await world({ [AGENT]: new Error("rpc down") });
    await create("billing-bot", AGENT);
    expect((await spend(t, key)).data).toEqual([{ label: "billing-bot", spent: null }]);
  });
  it("skips revoked agents and never reads another business's agents", async () => {
    const { t, key, create, asked } = await world({ [AGENT]: 1n, [OTHER]: 2n });
    await create("billing-bot", AGENT);
    await create("old-bot", OTHER);
    await t.req("/v1/ens/agents/old-bot", { method: "DELETE", key });
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect((await spend(t, other)).data).toEqual([]);
    expect((await spend(t, key)).data.map((d: any) => d.label)).toEqual(["billing-bot"]);
    expect(asked.map((a) => a.from)).toEqual([AGENT]);
  });
  it("needs a signed-in business", async () => {
    const { t } = await world();
    expect((await t.req("/v1/ens/agents/spend")).status).toBe(401);
  });
});
