import type { Hex } from "viem";

export type Settlement = { status: "pending" | "settled"; tx?: Hex };

/**
 * Replay protection. `claim` must be atomic: of two concurrent claims for one key, exactly one gets `true`.
 * The key is `<payer>:<nonce>` (the EIP-3009 authorization identity).
 */
export interface SettlementStore {
  claim(key: string): Promise<boolean>;
  get(key: string): Promise<Settlement | null>;
  /** Records the broadcast hash while the receipt is awaited (so a retry can point at it). */
  setTx(key: string, tx: Hex): Promise<void>;
  markSettled(key: string, tx: Hex): Promise<void>;
  /** Frees the key after a failure that provably moved no money (rejected before send, or reverted). */
  release(key: string): Promise<void>;
}

export class MemoryStore implements SettlementStore {
  private m = new Map<string, Settlement>();
  async claim(key: string) {
    if (this.m.has(key)) return false;
    this.m.set(key, { status: "pending" });
    return true;
  }
  async get(key: string) {
    return this.m.get(key) ?? null;
  }
  async setTx(key: string, tx: Hex) {
    this.m.set(key, { status: "pending", tx });
  }
  async markSettled(key: string, tx: Hex) {
    this.m.set(key, { status: "settled", tx });
  }
  async release(key: string) {
    this.m.delete(key);
  }
}

/** D1: the primary key makes `INSERT OR IGNORE` an atomic claim. Table in migrations/0001_settlements.sql. */
export class D1Store implements SettlementStore {
  constructor(private db: D1Database) {}
  async claim(key: string) {
    const r = await this.db.prepare("INSERT OR IGNORE INTO settlements (key, status) VALUES (?, 'pending')").bind(key).run();
    return r.meta.changes === 1;
  }
  async get(key: string) {
    const r = await this.db.prepare("SELECT status, tx FROM settlements WHERE key = ?").bind(key).first<{ status: "pending" | "settled"; tx: string | null }>();
    return r ? { status: r.status, tx: (r.tx ?? undefined) as Hex | undefined } : null;
  }
  async setTx(key: string, tx: Hex) {
    await this.db.prepare("UPDATE settlements SET tx = ? WHERE key = ?").bind(tx, key).run();
  }
  async markSettled(key: string, tx: Hex) {
    await this.db.prepare("UPDATE settlements SET status = 'settled', tx = ? WHERE key = ?").bind(tx, key).run();
  }
  async release(key: string) {
    await this.db.prepare("DELETE FROM settlements WHERE key = ?").bind(key).run();
  }
}
