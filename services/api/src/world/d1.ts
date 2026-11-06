import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../app";
import { approvals, worldEnrollments } from "../db/schema";
import type { ApprovalRepo, ApprovalRow } from "./approvals";
import type { EnrollmentRow, WorldRepo } from "./verify";

/** The World enrolment table in D1. The unique index on (action, nullifier) is what stops one person enrolling twice. */
export function d1WorldRepo(db: Db): WorldRepo {
  return {
    async insertEnrollment(row: EnrollmentRow) {
      const done = await db.insert(worldEnrollments).values(row).onConflictDoNothing().returning({ id: worldEnrollments.id });
      return done.length === 1 ? "inserted" : "duplicate";
    },
    async findByMerchant(merchantId, action) {
      const [r] = await db.select().from(worldEnrollments).where(and(eq(worldEnrollments.merchantId, merchantId), eq(worldEnrollments.action, action)));
      return r ?? null;
    },
    async nullifiersFor(merchantIds, action) {
      if (merchantIds.length === 0) return [];
      const rows = await db.select().from(worldEnrollments).where(and(inArray(worldEnrollments.merchantId, merchantIds), eq(worldEnrollments.action, action)));
      return rows.map((r) => ({ merchantId: r.merchantId, nullifier: r.nullifier }));
    },
  };
}

/** Approvals in D1. `transition` is one UPDATE ... WHERE status = from, so two requests can never both win an approval. */
export function d1ApprovalRepo(db: Db): ApprovalRepo {
  return {
    async insert(row) {
      await db.insert(approvals).values(row);
    },
    async get(id) {
      const [r] = await db.select().from(approvals).where(eq(approvals.id, id));
      return (r as ApprovalRow | undefined) ?? null;
    },
    async list(merchantId, operation) {
      return (await db.select().from(approvals).where(and(eq(approvals.merchantId, merchantId), eq(approvals.operation, operation))).orderBy(desc(approvals.createdAt))) as ApprovalRow[];
    },
    async transition(id, from, patch) {
      const done = await db.update(approvals).set(patch).where(and(eq(approvals.id, id), eq(approvals.status, from))).returning({ id: approvals.id });
      return done.length === 1;
    },
  };
}
