import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { BUSINESS_LABEL } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { ensNames } from "../db/schema";
import { fail } from "../errors";
import { runIdempotent } from "../idempotency";
import { clientIp } from "../lib/request";
import { invalid } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { ensAgentRoutes } from "./ensAgents";
import { ensDirectoryRoutes } from "./ensDirectory";
import type { Address } from "viem";

/** Words that belong to the platform. */
const RESERVED = new Set(["www", "api", "app", "admin", "stenmont", "mail", "shop", "docs", "status", "support", "root", "ens", "agent", "agents", "bot"]);
const label = z.string().regex(BUSINESS_LABEL, "3 to 32 lowercase letters, numbers or hyphens, not starting or ending with a hyphen").refine((l) => !RESERVED.has(l), "that name is reserved");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const ensRoutes = new Hono<AppEnv>();
ensRoutes.route("/agents", ensAgentRoutes);
ensRoutes.route("/directory", ensDirectoryRoutes);

type Row = typeof ensNames.$inferSelect;
const view = (r: Row) => ({ name: r.name, resolver: r.resolver, payoutLocked: r.payoutLocked === 1, status: r.status });
const load = async (c: { var: AppEnv["Variables"] }) => (await c.var.db.select().from(ensNames).where(eq(ensNames.merchantId, c.var.merchantId)))[0] ?? null;

/** Availability is advisory: claim-name still checks the chain and holds the database label lock. */
ensRoutes.get("/availability", async (c) => {
  const parsed = label.safeParse(c.req.query("label"));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!(await hitRateLimit(c.var.db, `ens:read:${c.var.merchantId}`, 60, 60, c.var.now()))) return fail(c, 429, "rate_limited", "Too many checks. Try again in a minute.");
  try {
    return c.json({ label: parsed.data, available: await c.var.ens.labelAvailable(parsed.data) });
  } catch {
    return fail(c, 502, "chain_error", "Availability could not be checked right now. Try again.");
  }
});

/** Resolve only the signed-in business's own registered name. Provider errors are not a missing record. */
ensRoutes.get("/resolution", async (c) => {
  const row = await load(c);
  if (!row || row.status !== "active") return fail(c, 404, "not_found", "This business has no name yet.");
  try {
    return c.json({ name: row.name, address: await c.var.ens.resolveAddress(row.name, { strict: true }) });
  } catch {
    return fail(c, 502, "chain_error", "Your name could not be resolved right now. Try again.");
  }
});

/** The name comes only from this tenant's saved registration, never a caller-supplied foreign name. */
ensRoutes.get("/authority",async c=>{
 const row=await load(c);if(!row||row.status!=="active")return fail(c,404,"not_found","This business has no name yet.");
 const parsed=address.safeParse(c.req.query("member")??c.var.merchant.address);if(!parsed.success)return invalid(c,parsed.error);
 if(!(await hitRateLimit(c.var.db,`ens:authority:${c.var.merchantId}`,10,60,c.var.now())))return fail(c,429,"rate_limited","Try again in a minute.");
 if(!c.var.ens.inspectAuthority)return fail(c,503,"inspection_unavailable","Authority inspection is unavailable.");
 try{return c.json(await c.var.ens.inspectAuthority({name:row.name,resolver:row.resolver as Address,member:parsed.data as Address}));}
 catch{return fail(c,502,"chain_error","Authority could not be read; no permissions were inferred.");}
});

ensRoutes.post("/claim-name", async (c) => {
  const parsed = z.strictObject({ label }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const { db, ens, merchant } = c.var;
  const now = c.var.now();

  return runIdempotent(c, merchant.id, async () => {
    if (!merchant.address) return fail(c, 409, "merchant_not_ready", "This business has no account yet.");
    if (await load(c)) return fail(c, 409, "name_exists", "This business already has a name.");
    // Each name costs the platform a few transactions on the test network, so claims are limited.
    const ok = [
      await hitRateLimit(db, `ens:claim:ip:${clientIp(c) ?? "unknown"}`, 10, 3_600, now),
      await hitRateLimit(db, "ens:claim:global", 200, 86_400, now),
    ];
    if (ok.includes(false)) return fail(c, 429, "rate_limited", "Too many names claimed. Try again later.");

    const l = parsed.data.label;
    // The unique index on the label is the lock: a second business racing for the same label loses here.
    const claimed = await db
      .insert(ensNames)
      .values({ merchantId: merchant.id, label: l, name: "", resolver: "", agentRegistry: "", status: "claiming", createdAt: now.toISOString() })
      .onConflictDoNothing()
      .returning({ id: ensNames.merchantId });
    if (claimed.length === 0) return fail(c, 409, "label_taken", `${l} is already taken. Try another name.`);
    const undo = () => db.delete(ensNames).where(and(eq(ensNames.merchantId, merchant.id), eq(ensNames.status, "claiming")));

    try {
      if (!(await ens.labelAvailable(l))) {
        await undo();
        return fail(c, 409, "label_taken", `${l} is already taken. Try another name.`);
      }
      const r = await ens.claimBusinessName({ label: l, payout: merchant.address as Address });
      await db
        .update(ensNames)
        .set({ name: r.name, resolver: r.resolver, agentRegistry: r.agentRegistry, txHashes: JSON.stringify(r.txHashes), status: "active" })
        .where(eq(ensNames.merchantId, merchant.id));
      await audit(db, { merchantId: merchant.id, actor: `merchant:${merchant.id}`, action: "ens.name_claimed", payload: { name: r.name, resolver: r.resolver, txHashes: r.txHashes } });
      return { status: 201 as const, body: { name: r.name, resolver: r.resolver, payoutLocked: false, status: "active" } };
    } catch (e) {
      console.error("ens claim failed", e);
      await undo(); // nothing half-made on our side; the steps already done onchain are skipped on the next try
      return fail(c, 502, "chain_error", "The name could not be created right now. Try again.");
    }
  });
});

ensRoutes.get("/name", async (c) => {
  const row = await load(c);
  return row && row.status === "active" ? c.json(view(row)) : fail(c, 404, "not_found", "This business has no name yet.");
});

ensRoutes.post("/finance", async (c) => {
  const parsed = z.strictObject({ member: address }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  return runIdempotent(c, c.var.merchantId, async () => {
    const row = await load(c);
    if (!row || row.status !== "active") return fail(c, 404, "not_found", "This business has no name yet.");
    if (row.payoutLocked === 1) return fail(c, 409, "payout_locked", "The payout is locked, so no more members can be added.");
    try {
      const txHash = await c.var.ens.grantProfileRole({ name: row.name, resolver: row.resolver as Address, member: parsed.data.member as Address });
      await audit(c.var.db, { merchantId: row.merchantId, actor: `merchant:${row.merchantId}`, action: "ens.finance_granted", payload: { member: parsed.data.member, txHash } });
      return { status: 200 as const, body: { member: parsed.data.member, record: "stenmont.profile", txHash } };
    } catch (e) {
      console.error("ens grant failed", e);
      return fail(c, 502, "chain_error", "The change could not be made right now. Try again.");
    }
  });
});

/** Permanent: afterwards no one, including the platform, can change where the name pays out. */
ensRoutes.post("/lock-payout", async (c) => {
  return runIdempotent(c, c.var.merchantId, async () => {
    const row = await load(c);
    if (!row || row.status !== "active") return fail(c, 404, "not_found", "This business has no name yet.");
    if (row.payoutLocked === 1) return fail(c, 409, "payout_locked", "The payout is already locked.");
    try {
      const txHash = await c.var.ens.lockPayout({ name: row.name, resolver: row.resolver as Address });
      await c.var.db.update(ensNames).set({ payoutLocked: 1 }).where(eq(ensNames.merchantId, row.merchantId));
      await audit(c.var.db, { merchantId: row.merchantId, actor: `merchant:${row.merchantId}`, action: "ens.payout_locked", payload: { name: row.name, txHash } });
      return { status: 200 as const, body: { ...view({ ...row, payoutLocked: 1 }), txHash } };
    } catch (e) {
      console.error("ens lock failed", e);
      return fail(c, 502, "chain_error", "The change could not be made right now. Try again.");
    }
  });
});
