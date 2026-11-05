import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "../migrations");
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, f), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
});

describe("migrations", () => {
  it("creates the core tables", () => {
    const names = db
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["merchants", "api_keys", "audit_log", "idempotency_keys"]) {
      expect(names).toContain(t);
    }
  });
  it("audit_log accepts inserts but refuses updates and deletes", () => {
    db.prepare(
      "insert into audit_log (merchant_id, actor, action, payload, created_at) values ('m1','system','test','{}','2026-11-06T00:00:00Z')",
    ).run();
    expect(() => db.exec("update audit_log set action='x'")).toThrow(/append-only/);
    expect(() => db.exec("delete from audit_log")).toThrow(/append-only/);
  });
  it("idempotency key is unique per merchant", () => {
    const ins = "insert into idempotency_keys (key, merchant_id, response, created_at) values ('k','m1','{}','t')";
    db.exec(ins);
    expect(() => db.exec(ins)).toThrow();
    db.exec("insert into idempotency_keys (key, merchant_id, response, created_at) values ('k','m2','{}','t')");
  });
});
