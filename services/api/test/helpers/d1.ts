import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A D1Database look-alike over node:sqlite, enough for drizzle's D1 driver. Unit tests only; staging runs the real thing. */
class Stmt {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}
  bind(...p: unknown[]) {
    return new Stmt(this.db, this.sql, p.map((v) => (v === undefined ? null : v)) as SQLInputValue[]);
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params), success: true, meta: {} };
  }
  async first(col?: string) {
    const r = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    return r ? (col ? r[col] : r) : null;
  }
  async run() { return this.executeBatch(); }
  /** D1 batches execute atomically without yielding between SQL statements. */
  executeBatch() {
    const statement = this.db.prepare(this.sql);
    if (statement.columns().length) {
      const results = statement.all(...this.params);
      const meta = this.db.prepare("SELECT changes() AS changes, last_insert_rowid() AS last_row_id").get()!;
      return { success: true, results, meta };
    }
    const r = statement.run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw(opts?: { columnNames?: boolean }) {
    const st = this.db.prepare(this.sql);
    st.setReturnArrays(true);
    const rows = st.all(...this.params);
    return opts?.columnNames ? [st.columns().map((c) => c.name), ...rows] : rows;
  }
}

export class FakeD1 {
  readonly raw: DatabaseSync;
  constructor() {
    this.raw = new DatabaseSync(":memory:");
    const dir = join(import.meta.dirname, "../../migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      this.raw.exec(readFileSync(join(dir, f), "utf8").replaceAll("--> statement-breakpoint", ""));
    }
  }
  prepare(sql: string) {
    return new Stmt(this.raw, sql);
  }
  async batch(stmts: Stmt[]) {
    this.raw.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(s.executeBatch());
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }
  async exec(sql: string) {
    this.raw.exec(sql);
    return { count: 1, duration: 0 };
  }
}

export const newD1 = () => new FakeD1() as unknown as D1Database & FakeD1;
