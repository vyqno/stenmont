import { eq } from "drizzle-orm";
import type { Db } from "../app";
import { paymentSwitch } from "../db/schema";

/** True when the business has paused payments. No row means never touched, so live. */
export async function isPaused(db: Db, merchantId: string): Promise<boolean> {
  const [row] = await db.select({ paused: paymentSwitch.paused }).from(paymentSwitch).where(eq(paymentSwitch.merchantId, merchantId));
  return row?.paused === 1;
}
