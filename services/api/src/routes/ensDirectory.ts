import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Address } from "viem";
import { z } from "zod";
import type { AppEnv } from "../app";
import { ensDirectory } from "../db/schema";
import { planDirectory, publishDirectory } from "../ens/publishDirectory";
import { fail } from "../errors";
import { runIdempotent } from "../idempotency";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";

/** The business's own words. Whether each is published is decided by `buildDirectory`, which says why when it is not. */
const body = z.strictObject({
  payUrl: z.string().max(2048).nullable().optional(),
  x402Url: z.string().max(2048).nullable().optional(),
  refund: z.string().max(1000).nullable().optional(),
});

export const ensDirectoryRoutes = new Hono<AppEnv>();

const settings = (c: { env: AppEnv["Bindings"] }) => ({ chainId: Number(c.env.WHITECHAIN_CHAIN_ID), usdt: c.env.USDT_ADDRESS as Address });

/** What would be published now, what was left out and why, and what ENS shows from our last write. */
ensDirectoryRoutes.get("/", async (c) => {
  const [row] = await c.var.db.select().from(ensDirectory).where(eq(ensDirectory.merchantId, c.var.merchantId));
  if (!row) return fail(c, 404, "not_found", "This business has not published a pay directory yet.");
  const plan = await planDirectory({ db: c.var.db, now: c.var.now(), ...settings(c) }, c.var.merchantId, row);
  return c.json({
    inputs: { payUrl: row.payUrl, x402Url: row.x402Url, refund: row.refund },
    records: plan.records,
    omitted: plan.omitted,
    published: JSON.parse(row.published) as Record<string, string>,
    publishedAt: row.publishedAt,
    txHash: row.txHash,
  });
});

ensDirectoryRoutes.post("/publish", async (c) => {
  const parsed = body.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, ens, merchantId } = c.var;
  const now = c.var.now();
  return runIdempotent(c, merchantId, async () => {
    // Each change is a transaction the platform pays for on the test network.
    const ok = [await hitRateLimit(db, `ens:directory:${merchantId}`, 10, 3_600, now), await hitRateLimit(db, "ens:directory:global", 300, 86_400, now)];
    if (ok.includes(false)) return fail(c, 429, "rate_limited", "Too many changes. Try again later.");
    const r = await publishDirectory({ db, ens, now, ...settings(c) }, merchantId, parsed.data);
    if (r.status === "no_name") return fail(c, 404, "no_name", "Give your business a name first.");
    if (r.status === "failed") return fail(c, 502, "chain_error", "The directory could not be published right now. Try again.");
    return { status: 200 as const, body: r };
  });
});
