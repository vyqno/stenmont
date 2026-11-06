import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Db } from "../app";
import { audit } from "../audit";
import { paymentSwitch, siteChecks, sites } from "../db/schema";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { CHECKS, runChecks, txtRecord, type CheckKind } from "../sites/checks";
import { parseSiteUrl } from "../sites/url";

const MAX_SITES = 5;
const createSchema = z.strictObject({
  url: z.string().max(2048),
  platform: z.string().regex(/^[a-z0-9_-]{1,30}$/).optional(),
});
const checkSchema = z.strictObject({ checks: z.array(z.enum(CHECKS)).min(1).optional() });
const switchSchema = z
  .strictObject({ paused: z.boolean().optional(), mode: z.enum(["test", "live"]).optional() })
  .refine((v) => v.paused !== undefined || v.mode !== undefined, "send paused, mode or both");

type SiteRow = typeof sites.$inferSelect;

async function views(db: Db, rows: SiteRow[]) {
  const checks = rows.length ? await db.select().from(siteChecks).where(inArray(siteChecks.siteId, rows.map((r) => r.id))) : [];
  return rows.map((s) => {
    const mine = Object.fromEntries(CHECKS.map((k) => {
      const c = checks.find((x) => x.siteId === s.id && x.kind === k);
      return [k, c ? { ok: c.ok === 1, detail: c.detail, checkedAt: c.checkedAt } : null];
    })) as Record<CheckKind, { ok: boolean; detail: string; checkedAt: string } | null>;
    return {
      id: s.id,
      url: s.url,
      host: s.host,
      platform: s.platform,
      createdAt: s.createdAt,
      verification: txtRecord(s),
      checks: mine,
      ready: CHECKS.every((k) => mine[k]?.ok === true),
    };
  });
}

const find = async (db: Db, merchantId: string, id: string) =>
  (await db.select().from(sites).where(and(eq(sites.id, id), eq(sites.merchantId, merchantId))))[0];

export const siteRoutes = new Hono<AppEnv>();

siteRoutes.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, merchantId } = c.var;
  const url = parseSiteUrl(parsed.data.url);
  if (!url.ok) return fail(c, 400, "invalid_site_url", url.reason);
  const mine = await db.select().from(sites).where(eq(sites.merchantId, merchantId));
  if (mine.some((s) => s.host === url.host)) return fail(c, 409, "site_exists", "This site is already registered.");
  if (mine.length >= MAX_SITES) return fail(c, 409, "too_many_sites", `A business can register at most ${MAX_SITES} sites.`);
  const row = { id: crypto.randomUUID(), merchantId, url: url.url, host: url.host, platform: parsed.data.platform ?? null, token: randomHex(16), createdAt: c.var.now().toISOString() };
  await db.insert(sites).values(row);
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "site.registered", payload: { id: row.id, host: row.host } });
  const view = (await views(db, [row]))[0]!;
  // First check runs in the background so the checks are not all "Not checked yet"; poll GET /v1/sites/:id for the result.
  // ponytail: no ExecutionContext (unit tests, local) means no automatic check; "Check again" still works.
  try {
    c.executionCtx.waitUntil(runChecks({ db, fetch: c.var.fetch, now: c.var.now() }, row, CHECKS).catch(() => {}));
  } catch {
    return c.json(view, 201);
  }
  return c.json({ ...view, checking: true }, 201);
});

siteRoutes.get("/", async (c) => {
  const rows = await c.var.db.select().from(sites).where(eq(sites.merchantId, c.var.merchantId)).orderBy(desc(sites.createdAt));
  return c.json({ data: await views(c.var.db, rows) });
});

siteRoutes.get("/:id", async (c) => {
  const row = await find(c.var.db, c.var.merchantId, c.req.param("id"));
  return row ? c.json((await views(c.var.db, [row]))[0]) : fail(c, 404, "not_found", "Site not found");
});

siteRoutes.post("/:id/check", async (c) => {
  const { db, merchantId } = c.var;
  const parsed = checkSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return invalid(c, parsed.error);
  const row = await find(db, merchantId, c.req.param("id"));
  if (!row) return fail(c, 404, "not_found", "Site not found");
  // Checks make outbound requests, so they are limited per business.
  if (!(await hitRateLimit(db, `sites:check:${merchantId}`, 12, 60, c.var.now()))) return fail(c, 429, "rate_limited", "Too many checks. Try again in a minute.");
  await runChecks({ db, fetch: c.var.fetch, now: c.var.now() }, row, parsed.data.checks ?? CHECKS);
  return c.json((await views(db, [row]))[0]);
});

siteRoutes.delete("/:id", async (c) => {
  const { db, merchantId } = c.var;
  const row = await find(db, merchantId, c.req.param("id"));
  if (!row) return fail(c, 404, "not_found", "Site not found");
  await db.delete(siteChecks).where(eq(siteChecks.siteId, row.id));
  await db.delete(sites).where(eq(sites.id, row.id));
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "site.removed", payload: { id: row.id, host: row.host } });
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------------------------------------------------
// The live / paused switch and the test / live label (one per business).

const switchView = (r?: typeof paymentSwitch.$inferSelect) => ({ paused: r?.paused === 1, mode: r?.mode ?? "test", updatedAt: r?.updatedAt ?? null });

export const switchRoutes = new Hono<AppEnv>();

switchRoutes.get("/", async (c) => {
  const [row] = await c.var.db.select().from(paymentSwitch).where(eq(paymentSwitch.merchantId, c.var.merchantId));
  return c.json(switchView(row));
});

switchRoutes.post("/", async (c) => {
  const parsed = switchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, merchantId } = c.var;
  const [before] = await db.select().from(paymentSwitch).where(eq(paymentSwitch.merchantId, merchantId));
  const next = {
    merchantId,
    paused: parsed.data.paused === undefined ? (before?.paused ?? 0) : parsed.data.paused ? 1 : 0,
    mode: parsed.data.mode ?? before?.mode ?? "test",
    updatedAt: c.var.now().toISOString(),
  };
  await db.insert(paymentSwitch).values(next).onConflictDoUpdate({ target: paymentSwitch.merchantId, set: next });
  const actor = `merchant:${merchantId}`;
  if (next.paused !== (before?.paused ?? 0)) await audit(db, { merchantId, actor, action: next.paused ? "payments.paused" : "payments.resumed", payload: {} });
  if (next.mode !== (before?.mode ?? "test")) await audit(db, { merchantId, actor, action: "payments.mode_changed", payload: { mode: next.mode } });
  return c.json(switchView(next));
});
