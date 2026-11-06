/** Caps and the payee allowlist. They run before any gas is spent; a rejected request claims nothing. */

export interface PayeeStore {
  isAllowed(payTo: string): Promise<boolean>;
}

/** `hit` must be atomic: it counts one use of `bucket` and returns false (without counting) once `limit` is reached. */
export interface CounterStore {
  hit(bucket: string, limit: number): Promise<boolean>;
  /** Gives back one use (a settlement that provably moved no money). */
  unhit(bucket: string): Promise<void>;
}

export type Limits = { perPayeeDay: number; globalDay: number; perPayerMinute: number };
export const DEFAULT_LIMITS: Limits = { perPayeeDay: 1000, globalDay: 5000, perPayerMinute: 10 };

export function limitsFromEnv(env: { SETTLE_MAX_PER_PAYEE_DAY?: string; SETTLE_MAX_GLOBAL_DAY?: string; SETTLE_MAX_PER_PAYER_MINUTE?: string }): Limits {
  const n = (v: string | undefined, d: number) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : d);
  return {
    perPayeeDay: n(env.SETTLE_MAX_PER_PAYEE_DAY, DEFAULT_LIMITS.perPayeeDay),
    globalDay: n(env.SETTLE_MAX_GLOBAL_DAY, DEFAULT_LIMITS.globalDay),
    perPayerMinute: n(env.SETTLE_MAX_PER_PAYER_MINUTE, DEFAULT_LIMITS.perPayerMinute),
  };
}

export class MemoryPayees implements PayeeStore {
  private s: Set<string>;
  constructor(addresses: string[] = []) {
    this.s = new Set(addresses.map((a) => a.toLowerCase()));
  }
  add(a: string) { this.s.add(a.toLowerCase()); }
  async isAllowed(a: string) { return this.s.has(a.toLowerCase()); }
}

export class MemoryCounters implements CounterStore {
  private m = new Map<string, number>();
  async hit(bucket: string, limit: number) {
    const n = this.m.get(bucket) ?? 0;
    if (n >= limit) return false;
    this.m.set(bucket, n + 1);
    return true;
  }
  async unhit(bucket: string) {
    this.m.set(bucket, Math.max(0, (this.m.get(bucket) ?? 0) - 1));
  }
}

/** Tables in migrations/0002_guard.sql. Manage the allowlist with `wrangler d1 execute` (no public endpoint). */
export class D1Payees implements PayeeStore {
  constructor(private db: D1Database) {}
  async isAllowed(a: string) {
    return (await this.db.prepare("SELECT 1 AS ok FROM payees WHERE address = ?").bind(a.toLowerCase()).first()) !== null;
  }
}

export class D1Counters implements CounterStore {
  constructor(private db: D1Database) {}
  async hit(bucket: string, limit: number) {
    if (limit <= 0) return false;
    // the WHERE on the upsert makes "count only if under the limit" one atomic statement
    const r = await this.db.prepare("INSERT INTO counters (bucket, n) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 WHERE n < ?").bind(bucket, limit).run();
    return r.meta.changes === 1;
  }
  async unhit(bucket: string) {
    await this.db.prepare("UPDATE counters SET n = n - 1 WHERE bucket = ? AND n > 0").bind(bucket).run();
  }
}
