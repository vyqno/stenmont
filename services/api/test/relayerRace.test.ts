import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";
import { seedInvoice } from "./helpers/fixtures";
import { Rejected } from "../src/chain";
import { holdGas, reserveGas, settleGas } from "../src/relayer/caps";
import { sendFromTank } from "../src/relayer/tankSend";
import { jitterD1, mulberry32, scheduler } from "./helpers/schedule";

// Gas accounting under adversarial interleaving. Every D1 statement and chain call waits a seeded-random number of
// microtask turns, so each seed is one reproducible interleaving of N simultaneous payments.
// Invariant after all requests finish: tank balance = initial - actual gas of the transactions sent, spent = the same
// amount, and nothing stays reserved.

const DAY = "2026-11-06";
const INITIAL = 10n ** 18n;
const COST = 150_000n * 5_000_000_000n; // actual cost of one payment
const salt = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

async function world(seed: number, cap = 5n * 10n ** 16n) {
  const tick = scheduler(seed);
  const t = setup({
    async estimateGas() {
      await tick();
      return 200_000n;
    },
    async gasPrice() {
      await tick();
      return 5_000_000_000n;
    },
    async sendTransaction(call) {
      await tick();
      t.chain.sent.push(call);
      return `0x${(1000 + t.chain.sent.length).toString(16).padStart(64, "0")}` as `0x${string}`;
    },
    async waitForReceipt() {
      await tick();
      return { status: "success", gasUsed: 150_000n, effectiveGasPrice: 5_000_000_000n };
    },
  });
  t.env.DB = jitterD1(t.db, tick) as never;
  await seedMerchant(t.db);
  const id = await seedInvoice(t.db, "INV-RACE", 1_000_000_000_000n);
  await t.db
    .prepare("insert into gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt, version) values ('m_1', ?, ?, '0', ?, ?, 0)")
    .bind(INITIAL.toString(), cap.toString(), DAY, (10n ** 12n).toString())
    .run();
  return { t, id };
}
type W = Awaited<ReturnType<typeof world>>;
const pay = ({ t, id }: W, i: number) =>
  t.req("/relay/pay", {
    method: "POST",
    headers: { "cf-connecting-ip": `10.0.${i}.1` },
    body: JSON.stringify({ invoiceId: id, value: "1", payer: addr(100 + i), validAfter: "0", validBefore: "9999999999", salt: salt(1_000 + i), signature: `0x${"22".repeat(65)}` }),
  });
async function tankOf(t: W["t"]) {
  const r = (await t.db.prepare("select * from gas_tanks where merchant_id = 'm_1'").first()) as Record<string, string>;
  return { balance: BigInt(r.wbt_balance!), spent: BigInt(r.spent_today_wbt!) };
}
async function expectClean(w: W, sent: number) {
  const { balance, spent } = await tankOf(w.t);
  expect(w.t.chain.sent).toHaveLength(sent);
  expect(spent).toBe(BigInt(sent) * COST);
  expect(balance).toBe(INITIAL - BigInt(sent) * COST);
}

describe("gas accounting under adversarial interleaving", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("50 simultaneous honest payments, seed %i: no reservation leaks", async (seed) => {
    const w = await world(seed);
    const codes = await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      for (let n = 0; n < 40; n++) {
        const s = (await pay(w, i)).status;
        if (s !== 503) return s;
      }
      return 503;
    }));
    const ok = codes.filter((c) => c === 200).length;
    expect(ok).toBe(50);
    await expectClean(w, ok);
  }, 60_000);

  it.each([11, 12, 13, 14])("busy answers hold nothing: one round of 50 with no retry, seed %i", async (seed) => {
    const w = await world(seed);
    const res = await Promise.all(Array.from({ length: 50 }, (_, i) => pay(w, i)));
    const ok = res.filter((r) => r.status === 200).length;
    expect(res.every((r) => r.status === 200 || r.status === 503)).toBe(true);
    await expectClean(w, ok);
  }, 60_000);
});

describe("payer usage under contention", () => {
  it.each([21, 22, 23])("30 simultaneous payments from ONE payer: usage equals what was paid, seed %i", async (seed) => {
    const w = await world(seed);
    const one = (i: number) =>
      w.t.req("/relay/pay", {
        method: "POST",
        headers: { "cf-connecting-ip": "10.9.9.9" },
        body: JSON.stringify({ invoiceId: w.id, value: "1", payer: addr(7), validAfter: "0", validBefore: "9999999999", salt: salt(5_000 + i), signature: `0x${"22".repeat(65)}` }),
      });
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => one(i)));
    const ok = res.filter((r) => r.status === 200).length;
    const usage = (await w.t.db.prepare("select usdt from payer_usage where merchant_id = 'm_1' and payer = ?").bind(addr(7)).first("usdt")) as string;
    expect(BigInt(usage)).toBe(BigInt(ok) * 1_000_000n); // value "1" is 1 USDT
    await expectClean(w, ok);
  }, 60_000);
});

describe("sendFromTank under contention", () => {
  it.each([31, 32, 33])("50 simultaneous tank-paid sends, seed %i: tank equals initial minus actual gas", async (seed) => {
    const w = await world(seed);
    const ctx = { db: drizzle(w.t.env.DB), chain: w.t.chain, now: w.t.clock.now };
    const res = await Promise.all(Array.from({ length: 50 }, () => sendFromTank(ctx, "m_1", { to: addr(9) as `0x${string}`, data: "0x" })));
    const ok = res.filter((r) => r.ok).length;
    expect(res.every((r) => r.ok || r.code === "busy")).toBe(true);
    await expectClean(w, ok);
  }, 60_000);
});

describe("a reservation made yesterday is settled against yesterday", () => {
  it("settling after midnight does not erase today's spend", async () => {
    const w = await world(41);
    const day1 = new Date("2026-11-06T23:59:59Z");
    const day2 = new Date("2026-11-07T00:00:01Z");
    const db = drizzle(w.t.db);
    await w.t.db.prepare("update gas_tanks set spent_day = '2026-11-06'").run();
    expect(await reserveGas(db, "m_1", 100n, day1)).toBe("ok");
    expect(await reserveGas(db, "m_1", 50n, day2)).toBe("ok"); // today's spend: 50
    expect(await settleGas(db, "m_1", 100n, 60n, day1)).toBe("ok"); // yesterday's reservation settles late
    const { balance, spent } = await tankOf(w.t);
    expect(balance).toBe(INITIAL - 60n - 50n);
    expect(spent).toBe(50n); // today's counter is untouched
  });
});

describe("every hold is settled or released exactly once", () => {
  it("settling twice charges once; releasing after settling does nothing", async () => {
    const w = await world(51);
    const db = drizzle(w.t.db);
    const hold = await holdGas(db, "m_1", 1_000n, w.t.clock.now);
    if (typeof hold === "string") throw new Error(hold);
    await hold.settle(400n);
    await hold.settle(400n);
    await hold.release();
    expect(await tankOf(w.t)).toEqual({ balance: INITIAL - 400n, spent: 400n });
  });

  it("a hold that failed to write can be settled again, and is then charged once", async () => {
    const w = await world(52);
    const db = drizzle(w.t.db);
    const hold = await holdGas(db, "m_1", 1_000n, w.t.clock.now);
    if (typeof hold === "string") throw new Error(hold);
    await w.t.db.prepare("create trigger boom before update on gas_tanks begin select raise(abort, 'down'); end").run();
    await expect(hold.release()).rejects.toThrow();
    await w.t.db.prepare("drop trigger boom").run();
    await hold.release();
    await hold.release();
    expect(await tankOf(w.t)).toEqual({ balance: INITIAL, spent: 0n });
  });

  it.each([61, 62, 63, 64, 65, 66])("random chain failures (rejects, send errors, reverts, timeouts), seed %i", async (seed) => {
    const tick = scheduler(seed);
    const rnd = mulberry32(seed * 7919);
    const MAX = 200_000n * 125n / 100n * 5_000_000_000n; // what a reservation holds
    const fate = new Map<string, "success" | "reverted" | "timeout">();
    let n = 0;
    const t = setup({
      async estimateGas() {
        await tick();
        if (rnd() < 0.15) throw new Rejected("execution reverted");
        return 200_000n;
      },
      async sendTransaction(call) {
        await tick();
        if (rnd() < 0.15) throw new Error("rpc down");
        t.chain.sent.push(call);
        const h = `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`;
        const r = rnd();
        fate.set(h, r < 0.15 ? "timeout" : r < 0.35 ? "reverted" : "success");
        // the books must balance at every observable moment, not only at the end
        const { balance, spent } = await tankOf(t);
        if (balance < 0n || spent > 5n * 10n ** 16n || balance + spent !== INITIAL) violations.push(`${balance} ${spent}`);
        return h;
      },
      async waitForReceipt(h) {
        await tick();
        const f = fate.get(h)!;
        if (f === "timeout") throw new Error("no receipt");
        return { status: f === "success" ? "success" : "reverted", gasUsed: 150_000n, effectiveGasPrice: 5_000_000_000n };
      },
    });
    const violations: string[] = [];
    t.env.DB = jitterD1(t.db, tick) as never;
    await seedMerchant(t.db);
    const id = await seedInvoice(t.db, "INV-CHAOS", 1_000_000_000_000n);
    await t.db
      .prepare("insert into gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt, version) values ('m_1', ?, ?, '0', ?, ?, 0)")
      .bind(INITIAL.toString(), (5n * 10n ** 16n).toString(), DAY, (10n ** 12n).toString())
      .run();
    const w = { t, id } as W;
    await Promise.all(Array.from({ length: 60 }, (_, i) => pay(w, i)));

    const outcomes = [...fate.values()];
    const charged = BigInt(outcomes.filter((f) => f !== "timeout").length) * COST + BigInt(outcomes.filter((f) => f === "timeout").length) * MAX;
    const { balance, spent } = await tankOf(t);
    expect(violations).toEqual([]);
    expect(spent).toBe(charged);
    expect(balance).toBe(INITIAL - charged);
    // nothing is left half-way: every row is finished, or is a timeout waiting to be reconciled
    const open = (await t.db.prepare("select count(*) n from relayer_txs where status = 'pending'").first("n")) as number;
    expect(open).toBe(0);
    // a payer's allowance is kept for payments that happened (success, timeout) and given back otherwise
    const used = (await t.db.prepare("select coalesce(sum(cast(usdt as integer)), 0) u from payer_usage").first("u")) as number;
    expect(used).toBe((outcomes.filter((f) => f !== "reverted").length) * 1_000_000);
  }, 60_000);
});
