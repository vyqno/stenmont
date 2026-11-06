import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../app";
import { gasTanks, payerUsage, rateLimits } from "../db/schema";

export const RATE_LIMIT_PER_MINUTE = 100;
export const DEFAULT_DAILY_GAS_CAP_WEI = 5n * 10n ** 16n; // 0.05 WBT per merchant per UTC day
export const DEFAULT_PER_PAYER_DAILY_CAP_USDT = 1_000n * 10n ** 6n;
/** The relayer wallet must keep at least this much (0.02 WBT) after a transaction, so it never runs dry mid-flight. */
export const RELAYER_MIN_BALANCE_WEI = 2n * 10n ** 16n;

export type CapError = "gas_tank_empty" | "gas_cap_reached" | "payer_cap" | "busy";

export const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Counts one hit against `key` in a fixed window. Returns false once the count exceeds `limit`. */
export async function hitRateLimit(db: Db, key: string, limit: number, windowSeconds: number, now: Date): Promise<boolean> {
  const bucket = Math.floor(now.getTime() / 1000 / windowSeconds);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, bucket, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.bucket], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  if (row!.count === 1) await db.delete(rateLimits).where(and(eq(rateLimits.key, key), sql`${rateLimits.bucket} < ${bucket}`));
  return row!.count <= limit;
}

export type Tank = {
  balance: bigint;
  dailyCap: bigint;
  spentToday: bigint; // already reset to 0 when the stored day is not today
  perPayerCap: bigint;
  version: number;
  day: string; // the UTC day `stored` belongs to
  stored: bigint; // spent amount exactly as stored, for the day above
};

export async function loadTank(db: Db, merchantId: string, now: Date): Promise<Tank | null> {
  const [t] = await db.select().from(gasTanks).where(eq(gasTanks.merchantId, merchantId));
  if (!t) return null;
  return {
    balance: BigInt(t.wbtBalance),
    dailyCap: BigInt(t.dailyCapWbt),
    spentToday: t.spentDay === dayOf(now) ? BigInt(t.spentTodayWbt) : 0n,
    perPayerCap: BigInt(t.perPayerDailyCapUsdt),
    version: t.version,
    day: t.spentDay,
    stored: BigInt(t.spentTodayWbt),
  };
}

/** A reservation that loses a few races is told "busy" and the caller retries; nothing was held, so nothing leaks. */
const ATTEMPTS = 8;
/**
 * Giving back or charging a reservation must never be abandoned: every failed compare-and-swap means another writer
 * succeeded, so this always finishes. The bound only guards against a stuck database, and then it throws (never a
 * silent "busy" that leaves gas held forever).
 */
const SETTLE_ATTEMPTS = 1_000;

type TankWrite = { balance: bigint; spent: bigint; day: string };

/** Optimistic update: retries when another request changed the row between our read and our write. */
async function writeTank(db: Db, merchantId: string, now: Date, change: (t: Tank) => TankWrite | CapError, attempts = ATTEMPTS): Promise<"ok" | CapError> {
  for (let i = 0; i < attempts; i++) {
    const t = await loadTank(db, merchantId, now);
    if (!t) return "gas_tank_empty";
    const next = change(t);
    if (typeof next === "string") return next;
    const hit = await db
      .update(gasTanks)
      .set({ wbtBalance: next.balance.toString(), spentTodayWbt: next.spent.toString(), spentDay: next.day, version: t.version + 1 })
      .where(and(eq(gasTanks.merchantId, merchantId), eq(gasTanks.version, t.version)))
      .returning({ v: gasTanks.version });
    if (hit.length > 0) return "ok";
  }
  return "busy";
}

/** Atomically sets aside `amount` wei of the merchant's tank for one transaction, within the daily cap. */
export const reserveGas = (db: Db, merchantId: string, amount: bigint, now: Date) =>
  writeTank(db, merchantId, now, (t) => {
    if (t.balance < amount) return "gas_tank_empty";
    if (t.spentToday + amount > t.dailyCap) return "gas_cap_reached";
    return { balance: t.balance - amount, spent: t.spentToday + amount, day: dayOf(now) };
  });

/**
 * After the receipt: give back what was reserved and charge what was actually used. Throws if it cannot be written.
 * `now` is when the reservation was made. If the tank has moved on to a later day, only the balance is corrected;
 * today's counter belongs to today's reservations and is left alone.
 */
export async function settleGas(db: Db, merchantId: string, reserved: bigint, actual: bigint, now: Date): Promise<"ok"> {
  const r = await writeTank(
    db,
    merchantId,
    now,
    (t) => {
      const refund = reserved - actual; // negative if the transaction cost more than reserved
      if (t.day !== dayOf(now)) return { balance: t.balance + refund, spent: t.stored, day: t.day };
      return { balance: t.balance + refund, spent: t.stored - refund < 0n ? 0n : t.stored - refund, day: t.day };
    },
    SETTLE_ATTEMPTS,
  );
  if (r !== "ok") throw new Error(`gas settlement for ${merchantId} could not be written (${r})`);
  return "ok";
}

/** One reserved amount of gas. Settling or releasing it happens at most once, however often the caller asks. */
export class GasHold {
  private done = false;
  constructor(
    private readonly db: Db,
    private readonly merchantId: string,
    readonly amount: bigint,
    private readonly now: Date,
  ) {}

  /** Charges `actual`, returns the rest. A second call does nothing. If writing fails it throws and may be retried. */
  async settle(actual: bigint): Promise<void> {
    if (this.done) return;
    this.done = true;
    try {
      await settleGas(this.db, this.merchantId, this.amount, actual, this.now);
    } catch (e) {
      this.done = false;
      throw e;
    }
  }

  release = () => this.settle(0n);
}

/** Reserves gas and hands back the hold that must be settled or released, or the reason it was refused. */
export async function holdGas(db: Db, merchantId: string, amount: bigint, now: Date): Promise<GasHold | CapError> {
  const r = await reserveGas(db, merchantId, amount, now);
  return r === "ok" ? new GasHold(db, merchantId, amount, now) : r;
}

async function writePayer(db: Db, merchantId: string, payer: string, day: string, change: (used: bigint) => bigint | "payer_cap", attempts = ATTEMPTS): Promise<"ok" | CapError> {
  const key = and(eq(payerUsage.merchantId, merchantId), eq(payerUsage.payer, payer), eq(payerUsage.day, day));
  await db.insert(payerUsage).values({ merchantId, payer, day, usdt: "0" }).onConflictDoNothing();
  for (let i = 0; i < attempts; i++) {
    const [row] = await db.select().from(payerUsage).where(key);
    const used = BigInt(row!.usdt);
    const next = change(used);
    if (typeof next === "string") return next;
    const hit = await db
      .update(payerUsage)
      .set({ usdt: next.toString() })
      .where(and(key, eq(payerUsage.usdt, row!.usdt)))
      .returning({ d: payerUsage.day });
    if (hit.length > 0) return "ok";
  }
  return "busy";
}

export const reservePayer = (db: Db, merchantId: string, payer: string, value: bigint, cap: bigint, now: Date) =>
  writePayer(db, merchantId, payer.toLowerCase(), dayOf(now), (used) => (used + value > cap ? "payer_cap" : used + value));

/** Gives back a payer's reserved amount. Throws if it cannot be written, so the allowance is never silently lost. */
export async function releasePayer(db: Db, merchantId: string, payer: string, value: bigint, now: Date): Promise<"ok"> {
  const r = await writePayer(db, merchantId, payer.toLowerCase(), dayOf(now), (used) => (used > value ? used - value : 0n), SETTLE_ATTEMPTS);
  if (r !== "ok") throw new Error(`payer allowance for ${merchantId} could not be released (${r})`);
  return "ok";
}

/**
 * Cheap read-only pre-check, run before anything is simulated: an empty tank or an exhausted payer is refused for free.
 * The atomic reservations (reserveGas, reservePayer) enforce the same limits under concurrency.
 */
export async function checkCaps(db: Db, merchantId: string, payer: string, value: bigint, now: Date): Promise<"ok" | CapError> {
  const tank = await loadTank(db, merchantId, now);
  if (!tank || tank.balance === 0n) return "gas_tank_empty";
  const [row] = await db
    .select()
    .from(payerUsage)
    .where(and(eq(payerUsage.merchantId, merchantId), eq(payerUsage.payer, payer.toLowerCase()), eq(payerUsage.day, dayOf(now))));
  if ((row ? BigInt(row.usdt) : 0n) + value > tank.perPayerCap) return "payer_cap";
  return "ok";
}
