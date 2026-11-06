import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "../app";
import { invoices, siteChecks, webhookEndpoints } from "../db/schema";
import { randomHex } from "../lib/crypto";
import { signWebhook } from "../lib/signature";
import { lookupTxt } from "./dns";
import { probeSite } from "./probe";
import { parseSiteUrl } from "./url";

export const CHECKS = ["reachable", "domain", "webhook", "payment"] as const;
export type CheckKind = (typeof CHECKS)[number];
export type CheckResult = { ok: boolean; detail: string };
export type SiteRow = { id: string; merchantId: string; url: string; host: string; token: string };
type Ctx = { db: Db; fetch: typeof fetch; now: Date };

export const txtRecord = (s: SiteRow) => ({ recordName: `_stenmont.${s.host}`, recordValue: `stenmont-verify=${s.token}` });

async function domain(s: SiteRow, { fetch }: Ctx): Promise<CheckResult> {
  const { recordName, recordValue } = txtRecord(s);
  const found = await lookupTxt(recordName, fetch);
  if (!found.ok) return { ok: false, detail: found.reason };
  if (found.records.some((r) => r.trim() === recordValue)) return { ok: true, detail: `Found ${recordValue} at ${recordName}.` };
  return found.records.some((r) => r.startsWith("stenmont-verify="))
    ? { ok: false, detail: `The record at ${recordName} does not match. It must be exactly ${recordValue}.` }
    : { ok: false, detail: `No TXT record found at ${recordName}. Add ${recordValue} there; DNS can take a few minutes.` };
}

/** A signed `site.test` event to the newest endpoint registered on this site's host. The secret never leaves the request. */
async function webhook(s: SiteRow, { db, fetch, now }: Ctx): Promise<CheckResult> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.merchantId, s.merchantId), eq(webhookEndpoints.active, 1)))
    .orderBy(desc(webhookEndpoints.createdAt));
  const ep = rows.find((r) => {
    const u = parseSiteUrl(r.url);
    return u.ok && (u.host === s.host || u.host.endsWith(`.${s.host}`));
  });
  if (!ep) return { ok: false, detail: `No webhook endpoint is registered on ${s.host}. Add one that points at your site (Settings, Webhooks).` };
  const body = JSON.stringify({ id: `evt_test_${randomHex(8)}`, type: "site.test", created: Math.floor(now.getTime() / 1000), data: { siteId: s.id, message: "Test event from Stenmont" }, livemode: false });
  const eventId = (JSON.parse(body) as { id: string }).id;
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json", "user-agent": "Stenmont-Webhooks/1", "stenmont-signature": await signWebhook(ep.secret, body, Math.floor(now.getTime() / 1000)), "stenmont-event-id": eventId },
      body,
    });
    await res.body?.cancel().catch(() => {});
    return res.status >= 200 && res.status < 300
      ? { ok: true, detail: `${new URL(ep.url).pathname} answered ${res.status} to a signed test event.` }
      : { ok: false, detail: `Your webhook answered ${res.status}. It must answer 2xx after checking the signature.` };
  } catch {
    return { ok: false, detail: "Your webhook did not answer in time." };
  }
}

/** Read from what already happened: a paid invoice of this business that sends the customer back to this site. Nothing is created. */
async function payment(s: SiteRow, { db }: Ctx): Promise<CheckResult> {
  const paid = await db
    .select({ number: invoices.number, successUrl: invoices.successUrl, updatedAt: invoices.updatedAt })
    .from(invoices)
    .where(and(eq(invoices.merchantId, s.merchantId), eq(invoices.status, "paid"), isNotNull(invoices.successUrl)))
    .orderBy(desc(invoices.updatedAt))
    .limit(200);
  const hit = paid.find((i) => URL.canParse(i.successUrl!) && new URL(i.successUrl!).hostname === s.host);
  return hit
    ? { ok: true, detail: `Invoice ${hit.number} was paid on ${hit.updatedAt.slice(0, 10)} and returned to this site.` }
    : { ok: false, detail: `No paid invoice has returned to ${s.host} yet. Make a test payment from your site (set successUrl to a page on it).` };
}

export async function runChecks(ctx: Ctx, site: SiteRow, which: readonly CheckKind[]): Promise<void> {
  const run: Record<CheckKind, () => Promise<CheckResult>> = {
    reachable: () => probeSite(site.url, ctx.fetch),
    domain: () => domain(site, ctx),
    webhook: () => webhook(site, ctx),
    payment: () => payment(site, ctx),
  };
  await Promise.all(
    which.map(async (kind) => {
      const r = await run[kind]().catch((): CheckResult => ({ ok: false, detail: "This check could not run. Try again." }));
      const row = { siteId: site.id, kind, ok: r.ok ? 1 : 0, detail: r.detail, checkedAt: ctx.now.toISOString() };
      await ctx.db.insert(siteChecks).values(row).onConflictDoUpdate({ target: [siteChecks.siteId, siteChecks.kind], set: row });
    }),
  );
}
