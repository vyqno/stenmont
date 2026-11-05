import { describe, expect, it } from "vitest";
import { Rejected } from "../src/chain";
import { seedMerchant, setup } from "./helpers/app";
import { seedInvoice } from "./helpers/fixtures";

// Attack scenarios against the relayer. Whatever the attacker does, the invariant is the same:
//   gas spent <= the merchant's daily cap, and (tank balance + spent) never changes, i.e. no gas is created or lost.
// A payment here costs 150_000 gas * 5 gwei = 7.5e14 wei; a reservation holds 1.25e15 until it settles.

const DAY = "2026-11-06";
const INITIAL = 10n ** 18n; // 1 WBT in the tank
const COST = 150_000n * 5_000_000_000n;
const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
type T = ReturnType<typeof setup>;

async function world(cap: bigint, chain = {}) {
  const t = setup(chain);
  await seedMerchant(t.db);
  const id = await seedInvoice(t.db, "INV-DRAIN", 1_000_000_000_000n);
  await t.db
    .prepare("insert into gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt, version) values ('m_1', ?, ?, '0', ?, ?, 0)")
    .bind(INITIAL.toString(), cap.toString(), DAY, (10n ** 12n).toString())
    .run();
  return { t, id };
}
const pay = (t: T, id: string, payer: string, n: number, ip: string, over: Record<string, unknown> = {}) =>
  t.req("/relay/pay", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
    body: JSON.stringify({ invoiceId: id, value: "1", payer, validAfter: "0", validBefore: "9999999999", salt: salt(n), signature: `0x${"22".repeat(65)}`, ...over }),
  });
const tank = async (t: T) => {
  const r = (await t.db.prepare("select * from gas_tanks where merchant_id = 'm_1'").first()) as Record<string, string>;
  return { balance: BigInt(r.wbt_balance!), spent: BigInt(r.spent_today_wbt!) };
};
async function expectBooksBalance(t: T, cap: bigint) {
  const { balance, spent } = await tank(t);
  expect(spent).toBeLessThanOrEqual(cap);
  expect(balance + spent).toBe(INITIAL);
  return spent;
}

describe("drain: replaying one signed authorization", () => {
  it("200 replays from one payer send exactly one transaction", async () => {
    const { t, id } = await world(5n * 10n ** 16n);
    const codes: number[] = [];
    for (let i = 0; i < 200; i++) codes.push((await pay(t, id, addr(1), 7, "3.3.3.3")).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(t.chain.sent).toHaveLength(1);
    expect(codes.filter((c) => c === 409).length).toBeGreaterThan(0);
    expect(codes.every((c) => c === 200 || c === 409 || c === 429)).toBe(true);
    expect(await expectBooksBalance(t, 5n * 10n ** 16n)).toBe(COST);
  });

  it("the same replay fired concurrently still sends one transaction", async () => {
    const { t, id } = await world(5n * 10n ** 16n);
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => pay(t, id, addr(1), 7, `3.3.${i}.3`)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(t.chain.sent).toHaveLength(1);
    expect(await expectBooksBalance(t, 5n * 10n ** 16n)).toBe(COST);
  });
});

describe("drain: legitimate load plus one hostile payer", () => {
  it("50 honest payers all get through, the replayer costs one transaction, and spend stays under the cap", async () => {
    const cap = 5n * 10n ** 16n; // 0.05 WBT: room for 50 payments (3.75e16)
    const { t, id } = await world(cap);
    // all 50 arrive at the same instant; a payment that finds the budget held by others is told "busy" and retries
    const withRetry = async (i: number) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const r = await pay(t, id, addr(100 + i), 1_000 + i, `10.0.${i}.1`);
        if (r.status !== 503) return r.status;
      }
      return 503;
    };
    const honest = await Promise.all(Array.from({ length: 50 }, (_, i) => withRetry(i)));
    expect(honest.every((s) => s === 200)).toBe(true);
    for (let i = 0; i < 200; i++) await pay(t, id, addr(1), 7, "66.66.66.66"); // the attacker
    expect(t.chain.sent).toHaveLength(51);
    expect(await expectBooksBalance(t, cap)).toBe(51n * COST);
  });
});

describe("drain: fresh authorizations, unlimited supply", () => {
  it("one payer signing endlessly is stopped by the per-minute limit and the gas cap; spend never exceeds the cap", async () => {
    const cap = 2n * 10n ** 16n; // room for about 26 payments
    const { t, id } = await world(cap);
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 300; i++) {
      const s = (await pay(t, id, addr(5), 10_000 + i, "9.9.9.9")).status;
      if (s === 200) ok++;
      if (s === 429) limited++;
    }
    expect(ok).toBeLessThanOrEqual(Number(cap / COST));
    expect(limited).toBeGreaterThan(0);
    expect(t.chain.sent).toHaveLength(ok);
    await expectBooksBalance(t, cap);
  });

  it("one IP rotating payer addresses is stopped at 100 requests a minute and by the cap", async () => {
    const cap = 5n * 10n ** 16n;
    const { t, id } = await world(cap);
    for (let i = 0; i < 250; i++) await pay(t, id, addr(2_000 + i), 20_000 + i, "8.8.8.8");
    expect(t.chain.sent.length).toBeLessThanOrEqual(100); // the IP limit
    await expectBooksBalance(t, cap);
    const after = t.chain.sent.length;
    t.clock.now = new Date(t.clock.now.getTime() + 61_000); // a new minute: the IP may continue, the cap still binds
    for (let i = 0; i < 100; i++) await pay(t, id, addr(3_000 + i), 30_000 + i, "8.8.8.8");
    expect(t.chain.sent.length).toBeGreaterThanOrEqual(after);
    await expectBooksBalance(t, cap);
  });

  it("when the merchant's cap is hit, every further request is refused without touching the chain", async () => {
    const cap = 3n * 10n ** 15n; // about 4 payments
    const { t, id } = await world(cap);
    for (let i = 0; i < 20; i++) await pay(t, id, addr(50 + i), 40_000 + i, `7.7.${i}.1`);
    const sentAtCap = t.chain.sent.length;
    const estimates = t.chain.counts.estimate;
    const res = await pay(t, id, addr(999), 50_000, "1.2.3.4");
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("gas_cap_reached");
    expect(t.chain.sent).toHaveLength(sentAtCap);
    expect(t.chain.counts.estimate).toBe(estimates + 1); // simulated (to price it) but never sent
  });
});

describe("drain: garbage costs the relayer nothing", () => {
  it("a flood of invalid authorizations spends no gas and sends nothing", async () => {
    const { t, id } = await world(5n * 10n ** 16n, {
      async estimateGas(): Promise<bigint> {
        throw new Rejected("execution reverted");
      },
    });
    for (let i = 0; i < 400; i++) await pay(t, id, addr(60 + (i % 7)), 60_000 + i, `5.5.${i % 250}.${i % 3}`);
    expect(t.chain.sent).toHaveLength(0);
    expect(await expectBooksBalance(t, 5n * 10n ** 16n)).toBe(0n);
  });
});
