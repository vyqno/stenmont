import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { merchants, storeSettings } from "../db/schema";
import { fail } from "../errors";
import { runIdempotent } from "../idempotency";
import { clientIp } from "../lib/request";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { isPaused } from "../sites/switch";
import { cartSchema, placeOrder } from "./checkout";

/** A shopper sends variant ids and quantities and nothing else: no prices, no return addresses, no payee. */
const shopperCart = cartSchema.omit({ successUrl: true, cancelUrl: true });

export const storeCheckoutRoutes = new Hono<AppEnv>();

/**
 * Public, no key: the shop pages call this from the browser. It is the merchant checkout (same server-side pricing, atomic stock,
 * same invoice code) with the business taken from the store address, and with limits, because every order holds stock and makes
 * a transaction the platform pays for.
 */
storeCheckoutRoutes.post("/:slug/checkout", async (c) => {
  const { db } = c.var;
  const [row] = await db
    .select({ s: storeSettings, m: merchants })
    .from(storeSettings)
    .innerJoin(merchants, eq(merchants.id, storeSettings.merchantId))
    .where(eq(storeSettings.slug, c.req.param("slug")));
  if (!row || row.m.status !== "active") return fail(c, 404, "not_found", "Store not found");

  // Per shopper address first, then per store, so one shopper cannot hold all the stock and a crowd cannot use up the
  // business's own invoice allowance. ponytail: shoppers behind one shared address (an office) share that allowance.
  const now = c.var.now();
  const within = [
    await hitRateLimit(db, `shop:ip:${clientIp(c) ?? "unknown"}:${row.m.id}`, 10, 60, now),
    await hitRateLimit(db, `shop:ip-day:${clientIp(c) ?? "unknown"}:${row.m.id}`, 100, 86_400, now),
    await hitRateLimit(db, `shop:store:${row.m.id}`, 30, 60, now),
    await hitRateLimit(db, `shop:store-day:${row.m.id}`, 1_000, 86_400, now),
  ];
  if (within.includes(false)) return fail(c, 429, "rate_limited", "Too many orders right now. Please try again in a minute.");

  const parsed = shopperCart.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (await isPaused(db, row.m.id)) return fail(c, 403, "payments_paused", "This shop has paused orders for now. Please try again later.");

  c.set("merchantId", row.m.id);
  c.set("merchant", row.m);
  const back = `${c.env.APP_URL}/store/${row.s.slug}`;
  // The idempotency record belongs to the store, not a person: a shopper's key is a random value only their browser knows.
  return runIdempotent(c, `shop:${row.m.id}`, async () => {
    const made = await placeOrder(c, { ...parsed.data, successUrl: `${back}?thanks=1`, cancelUrl: back });
    if (made instanceof Response) return made;
    const b = made.body as { orderId: string; total: string; lines: unknown[]; invoice: { id: string; payUrl: string } };
    return { status: made.status, body: { orderId: b.orderId, total: b.total, lines: b.lines, invoiceId: b.invoice.id, payUrl: b.invoice.payUrl } };
  });
});
