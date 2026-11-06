import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Address } from "viem";
import { z } from "zod";
import { BUSINESS_LABEL, fromUnits, toUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { audit } from "../audit";
import { ensAgents, ensNames } from "../db/schema";
import { fail } from "../errors";
import { runIdempotent } from "../idempotency";
import { randomHex } from "../lib/crypto";
import { amountSchema, invalid, isPublicHttpsUrl } from "../lib/validation";
import { hitRateLimit } from "../relayer/caps";
import { requireApproval } from "../world/approvals";
import { d1ApprovalRepo } from "../world/d1";

/** What an agent may be allowed to do. The agent still needs its own key and the business's API for anything else. */
export const SCOPES = ["pay", "invoice.read", "refund.draft"] as const;
/** A daily limit above this is a big grant: a person must approve it with World first. */
const APPROVAL_DAILY_LIMIT = 100_000_000n;
const MAX_AGENTS = 20;

const createBody = z
  .strictObject({
    label: z.string().regex(BUSINESS_LABEL, "3 to 32 lowercase letters, numbers or hyphens"),
    agentAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
    dailyLimit: amountSchema,
    perTxLimit: amountSchema,
    expiresInDays: z.number().int().min(1).max(365).default(30),
    context: z.string().max(500).optional(),
    endpoint: z.string().max(2048).refine(isPublicHttpsUrl, "must be a public https URL").optional(),
  })
  .refine((b) => toUnits(b.perTxLimit) <= toUnits(b.dailyLimit), { message: "the per-payment limit cannot exceed the daily limit", path: ["perTxLimit"] });

type Row = typeof ensAgents.$inferSelect;
const view = (r: Row, now: Date) => ({
  label: r.label,
  name: r.name,
  agentAddress: r.agentAddress,
  scopes: JSON.parse(r.scopes) as string[],
  dailyLimit: fromUnits(BigInt(r.dailyLimit)),
  perTxLimit: fromUnits(BigInt(r.perTxLimit)),
  expiresAt: r.expiresAt,
  status: r.status === "active" && Date.parse(r.expiresAt) <= now.getTime() ? "expired" : r.status,
});

export const ensAgentRoutes = new Hono<AppEnv>();

ensAgentRoutes.post("/", async (c) => {
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;
  const { db, ens, merchant } = c.var;
  const now = c.var.now();

  return runIdempotent(c, merchant.id, async () => {
    const [biz] = await db.select().from(ensNames).where(eq(ensNames.merchantId, merchant.id));
    if (!biz || biz.status !== "active") return fail(c, 404, "no_name", "Give your business a name first.");
    if ((await db.select({ id: ensAgents.id }).from(ensAgents).where(eq(ensAgents.merchantId, merchant.id))).length >= MAX_AGENTS) return fail(c, 409, "too_many_agents", `A business can have at most ${MAX_AGENTS} agents.`);
    if (!(await hitRateLimit(db, "ens:agents:global", 300, 86_400, now))) return fail(c, 429, "rate_limited", "Too many agents created today. Try again tomorrow.");

    if (toUnits(b.dailyLimit) > APPROVAL_DAILY_LIMIT) {
      // The exact terms a person must approve; they are matched again, and used up, when the agent is created.
      const approvalParams = { label: b.label, agentAddress: b.agentAddress, dailyLimit: b.dailyLimit, perTxLimit: b.perTxLimit };
      const gate = await requireApproval(d1ApprovalRepo(db), { merchantId: merchant.id, operation: "agent_limit", params: approvalParams, now });
      if (!gate.ok) return fail(c, 409, gate.code, gate.message, { approvalParams });
    }

    const id = `ag_${randomHex(10)}`;
    const name = `${b.label}.${biz.name}`;
    const expiresAt = new Date(now.getTime() + b.expiresInDays * 86_400_000);
    const claimed = await db
      .insert(ensAgents)
      .values({ id, merchantId: merchant.id, label: b.label, name, agentAddress: b.agentAddress, resolver: "", scopes: JSON.stringify(b.scopes), dailyLimit: toUnits(b.dailyLimit).toString(), perTxLimit: toUnits(b.perTxLimit).toString(), expiresAt: expiresAt.toISOString(), status: "creating", createdAt: now.toISOString() })
      .onConflictDoNothing()
      .returning({ id: ensAgents.id });
    if (claimed.length === 0) return fail(c, 409, "label_taken", `${b.label} is already used by one of your agents.`);
    const undo = () => db.delete(ensAgents).where(and(eq(ensAgents.id, id), eq(ensAgents.status, "creating")));

    try {
      if (!(await ens.agentLabelAvailable({ businessName: biz.name, agentRegistry: biz.agentRegistry as Address, label: b.label }))) {
        await undo();
        return fail(c, 409, "label_taken", `${b.label} is already taken.`);
      }
      const r = await ens.createAgent({
        businessName: biz.name,
        agentRegistry: biz.agentRegistry as Address,
        label: b.label,
        agent: b.agentAddress as Address,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
        context: b.context ?? `Agent of ${biz.name}`,
        endpoint: b.endpoint ?? null,
        limits: JSON.stringify({ dailyLimit: b.dailyLimit, perTxLimit: b.perTxLimit, scopes: b.scopes }),
      });
      await db.update(ensAgents).set({ resolver: r.resolver, txHashes: JSON.stringify(r.txHashes), status: "active" }).where(eq(ensAgents.id, id));
      await audit(db, { merchantId: merchant.id, actor: `merchant:${merchant.id}`, action: "ens.agent_created", payload: { name: r.name, agent: b.agentAddress, txHashes: r.txHashes } });
      const [row] = await db.select().from(ensAgents).where(eq(ensAgents.id, id));
      return { status: 201 as const, body: view(row!, now) };
    } catch (e) {
      console.error("ens agent failed", e);
      await undo();
      return fail(c, 502, "chain_error", "The agent could not be created right now. Try again.");
    }
  });
});

ensAgentRoutes.get("/", async (c) => {
  const rows = await c.var.db.select().from(ensAgents).where(eq(ensAgents.merchantId, c.var.merchantId)).orderBy(desc(ensAgents.createdAt));
  return c.json({ data: rows.filter((r) => r.status !== "creating").map((r) => view(r, c.var.now())) });
});

/**
 * What each live agent's address sent in USDT in about the last 24 hours, read from the token's own Transfer events (the agent
 * signs its payments, so they leave its address whichever service sends the transaction). `spent` is null when it could not be
 * read, which is different from zero. Approximate window: see `windowStartBlock`.
 */
ensAgentRoutes.get("/spend", async (c) => {
  const rows = (await c.var.db.select().from(ensAgents).where(eq(ensAgents.merchantId, c.var.merchantId))).filter((r) => r.status === "active");
  const read = await Promise.allSettled(rows.map((r) => c.var.chain.usdtSentSince(r.agentAddress as Address, 86_400)));
  return c.json({ windowHours: 24, data: rows.map((r, i) => ({ label: r.label, spent: read[i]!.status === "fulfilled" ? fromUnits((read[i] as PromiseFulfilledResult<bigint>).value) : null })) });
});

/** Revokes an agent: it loses the right to edit its record and its name stops existing. */
ensAgentRoutes.delete("/:label", async (c) => {
  const { db, ens, merchantId } = c.var;
  const [row] = await db.select().from(ensAgents).where(and(eq(ensAgents.merchantId, merchantId), eq(ensAgents.label, c.req.param("label"))));
  if (!row || row.status === "creating") return fail(c, 404, "not_found", "Agent not found");
  if (row.status === "revoked") return fail(c, 409, "already_revoked", "This agent is already revoked.");
  const [biz] = await db.select().from(ensNames).where(eq(ensNames.merchantId, merchantId));
  try {
    const txHashes = await ens.revokeAgent({ name: row.name, label: row.label, agentRegistry: biz!.agentRegistry as Address, resolver: row.resolver as Address, agent: row.agentAddress as Address });
    await db.update(ensAgents).set({ status: "revoked" }).where(eq(ensAgents.id, row.id));
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "ens.agent_revoked", payload: { name: row.name, txHashes } });
    return c.json(view({ ...row, status: "revoked" }, c.var.now()));
  } catch (e) {
    console.error("ens agent revoke failed", e);
    return fail(c, 502, "chain_error", "The agent could not be revoked right now. Try again.");
  }
});
