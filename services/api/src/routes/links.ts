import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fromUnits, toUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { paymentLinks } from "../db/schema";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { amountSchema, invalid } from "../lib/validation";

const createSchema = z.strictObject({
  amount: amountSchema.optional(),
  reusable: z.boolean().default(false),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/).optional(),
});

type Row = typeof paymentLinks.$inferSelect;
const view = (r: Row, appUrl: string) => ({
  id: r.id,
  slug: r.slug,
  amount: r.amount ? fromUnits(BigInt(r.amount)) : null,
  reusable: r.reusable === 1,
  active: r.active === 1,
  url: `${appUrl}/l/${r.slug}`,
  createdAt: r.createdAt,
});

export const linkRoutes = new Hono<AppEnv>();

linkRoutes.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, merchantId } = c.var;
  const slug = parsed.data.slug ?? randomHex(4);
  const [taken] = await db.select({ id: paymentLinks.id }).from(paymentLinks).where(eq(paymentLinks.slug, slug));
  if (taken) return fail(c, 409, "slug_taken", "That slug is already used");
  const id = crypto.randomUUID();
  await db.insert(paymentLinks).values({
    id,
    merchantId,
    slug,
    amount: parsed.data.amount ? toUnits(parsed.data.amount).toString() : null,
    reusable: parsed.data.reusable ? 1 : 0,
    createdAt: new Date().toISOString(),
  });
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "payment_link.created", payload: { id, slug } });
  const [row] = await db.select().from(paymentLinks).where(eq(paymentLinks.id, id));
  return c.json(view(row!, c.env.APP_URL), 201);
});

linkRoutes.get("/", async (c) => {
  const rows = await c.var.db
    .select()
    .from(paymentLinks)
    .where(eq(paymentLinks.merchantId, c.var.merchantId))
    .orderBy(desc(paymentLinks.createdAt));
  return c.json({ data: rows.map((r) => view(r, c.env.APP_URL)) });
});
