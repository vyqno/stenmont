import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { kycWebhookEvents, tierBadges, ensNames, verificationRecords } from "../db/schema";
import { fail } from "../errors";
import { randomHex } from "../lib/crypto";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { defaultProvider, kycProvider, type KycDecision, type KycProvider } from "../verification/kyc/provider";
import { publishTierBadge } from "../verification/badge";
import { loadFacts, loadLimits, merchantTier, volumeToday } from "../verification/store";
import { computeTier, nextStepFor } from "../verification/tiers";

export const verificationRoutes = new Hono<AppEnv>();

/** Where the business stands: its tier, what each tier allows, what to do next. Nothing from a provider but the decision. */
verificationRoutes.get("/", async (c) => {
  const { db, merchantId } = c.var;
  const now = c.var.now();
  const facts = await loadFacts(db, merchantId);
  const { tier, via } = computeTier(facts, now);
  const limits = await loadLimits(db);
  return c.json({
    tier,
    via,
    nextStep: nextStepFor(tier),
    usedToday: fromUnits(await volumeToday(db, merchantId, now)),
    limits: [0, 1, 2, 3, 4].map((t) => ({
      tier: t,
      perInvoice: fromUnits(limits[t]!.perInvoice),
      dailyVolume: fromUnits(limits[t]!.dailyVolume),
      financing: limits[t]!.financingCap > 0n,
      financingCap: fromUnits(limits[t]!.financingCap),
      investor: limits[t]!.investor,
    })),
    facts: { worldEnrolled: facts.worldEnrolled, domainVerified: facts.domainVerified },
    records: facts.records.map((r) => ({ method: r.method, decision: r.decision, decidedAt: r.decidedAt, expiresAt: r.expiresAt })),
    badge: await (async () => {
      const [n] = await db.select().from(ensNames).where(eq(ensNames.merchantId, merchantId));
      const [b] = await db.select().from(tierBadges).where(eq(tierBadges.merchantId, merchantId));
      return n?.status === "active" ? { name: n.name, publishedTier: b?.publishedTier ?? null, publishedAt: b?.publishedAt ?? null } : null;
    })(),
    kyc: (() => {
      const p = defaultProvider(c.env);
      return { available: !!p, provider: p?.name ?? null, sandbox: p?.sandbox ?? false };
    })(),
  });
});

/** Writes the business's current tier to its ENS name now (the hourly job does it too). */
verificationRoutes.post("/badge/publish", async (c) => {
  const { db, merchantId } = c.var;
  if (!(await hitRateLimit(db, `badge:${merchantId}`, 10, 3_600, c.var.now()))) return fail(c, 429, "rate_limited", "Too many requests. Try again later.");
  return c.json(await publishTierBadge({ db, ens: c.var.ens, now: c.var.now() }, merchantId));
});

/** Opens a document check at the provider. The business is sent to `url` to complete it; the decision arrives by webhook. */
verificationRoutes.post("/kyc/start", async (c) => {
  const { db, merchantId } = c.var;
  const provider = defaultProvider(c.env);
  if (!provider) return fail(c, 503, "kyc_unavailable", "Document verification is not available right now.");
  if (!(await hitRateLimit(db, `kyc:start:${merchantId}`, 5, 3_600, c.var.now()))) return fail(c, 429, "rate_limited", "Too many verification attempts. Try again later.");
  const now = c.var.now();
  const { tier, via } = await merchantTier(db, merchantId, now);
  if (tier === 4 && via === "kyc") return fail(c, 409, "already_verified", "This business already passed the document check.");
  const started = await provider.startCheck({ merchantId, appUrl: c.env.APP_URL, now });
  await db.insert(verificationRecords).values({
    id: crypto.randomUUID(),
    merchantId,
    tier: 4,
    method: "kyc",
    provider: provider.name,
    reference: started.reference,
    decision: "pending",
    decidedAt: now.toISOString(),
    expiresAt: null,
  });
  await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "verification.kyc_started", payload: { provider: provider.name, reference: started.reference } });
  return c.json({ provider: provider.name, sandbox: provider.sandbox, reference: started.reference, url: started.url }, 201);
});

/** Applies one provider decision to the record it belongs to. Shared by the webhook and the sandbox shortcut. */
async function applyDecision(c: Context<AppEnv>, provider: KycProvider, d: KycDecision) {
  const { db } = c.var;
  const now = c.var.now();
  const claimed = await db.insert(kycWebhookEvents).values({ provider: provider.name, eventId: d.eventId, receivedAt: now.toISOString() }).onConflictDoNothing().returning({ id: kycWebhookEvents.eventId });
  if (claimed.length === 0) return c.json({ ok: true, duplicate: true });
  try {
    const [record] = await db.select().from(verificationRecords).where(and(eq(verificationRecords.provider, provider.name), eq(verificationRecords.reference, d.reference)));
    if (!record) return c.json({ ok: true, ignored: "unknown_reference" });
    if (d.occurredAt.getTime() < Date.parse(record.decidedAt)) return c.json({ ok: true, ignored: "stale" }); // an older decision cannot overwrite a newer one
    const before = (await merchantTier(db, record.merchantId, now)).tier;
    await db.update(verificationRecords).set({ decision: d.decision, decidedAt: d.occurredAt.toISOString(), expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null }).where(eq(verificationRecords.id, record.id));
    const after = (await merchantTier(db, record.merchantId, now)).tier;
    await audit(db, { merchantId: record.merchantId, actor: `kyc:${provider.name}`, action: "verification.kyc_decision", payload: { provider: provider.name, reference: d.reference, decision: d.decision, tierBefore: before, tierAfter: after } });
    return c.json({ ok: true });
  } catch (e) {
    await db.delete(kycWebhookEvents).where(and(eq(kycWebhookEvents.provider, provider.name), eq(kycWebhookEvents.eventId, d.eventId))); // let the provider retry
    throw e;
  }
}

const MAX_BODY = 16_384;

/** The provider's webhook. Signature first, then freshness, then once-only by event id. */
export const kycWebhookRoutes = new Hono<AppEnv>();
kycWebhookRoutes.post("/:provider", async (c) => {
  const provider = kycProvider(c.req.param("provider"), c.env);
  if (!provider) return fail(c, 404, "not_found", "Not found");
  const raw = await c.req.text();
  if (raw.length > MAX_BODY) return fail(c, 413, "too_large", "Body too large");
  const parsed = await provider.parseWebhook(raw, c.req.raw.headers, c.var.now());
  if (!parsed.ok) return parsed.reason === "bad_signature" ? fail(c, 401, "bad_signature", "Signature check failed") : fail(c, 400, "invalid_request", "Unreadable event");
  const decision = provider.mapDecision(parsed.event);
  if (!decision) return fail(c, 400, "invalid_request", "Unreadable event");
  return applyDecision(c, provider, decision);
});

/** Sandbox only: completes your own pending check, as the provider's page would. Not available in production. */
verificationRoutes.post("/kyc/sandbox-decision", async (c) => {
  const parsed = z.strictObject({ result: z.enum(["green", "red", "review"]) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const provider = kycProvider("mock", c.env);
  if (!provider) return fail(c, 404, "not_found", "Not found");
  const [pending] = await c.var.db
    .select()
    .from(verificationRecords)
    .where(and(eq(verificationRecords.merchantId, c.var.merchantId), eq(verificationRecords.provider, "mock"), eq(verificationRecords.decision, "pending")))
    .orderBy(desc(verificationRecords.decidedAt))
    .limit(1);
  if (!pending?.reference) return fail(c, 409, "no_pending_check", "Start a document check first.");
  const body = { id: `evt_sandbox_${randomHex(8)}`, type: "check.completed", reference: pending.reference, result: parsed.data.result, occurredAt: c.var.now().toISOString() };
  const d = provider.mapDecision({ id: body.id, reference: body.reference!, raw: body });
  return applyDecision(c, provider, d!);
});
