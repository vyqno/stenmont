import type { Db } from "./app";
import { auditLog } from "./db/schema";

export async function audit(
  db: Db,
  entry: { merchantId: string | null; actor: string; action: string; payload: unknown },
): Promise<void> {
  await db.insert(auditLog).values({
    merchantId: entry.merchantId,
    actor: entry.actor,
    action: entry.action,
    payload: JSON.stringify(entry.payload),
    createdAt: new Date().toISOString(),
  });
}
