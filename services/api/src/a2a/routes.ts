import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { A2A_KEY, fromUnits, toUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { ensNames, invoices, merchants, products, variants } from "../db/schema";
import type { Address } from "viem";
import { hitRateLimit } from "../relayer/caps";
import { fail } from "../errors";
import { covers, parseScopes } from "../oauth/scopes";
import { sha256Hex } from "../lib/crypto";
import { agentCard, scopeFor, SKILLS } from "./protocol";
const id = z.string().min(1).max(200);
const object = z.record(z.string(), z.unknown());
const payload = z.object({ skill: z.enum(SKILLS), input: object.default({}) }).strict();
const send = z.object({ message: z.object({ messageId: id, role: z.literal("ROLE_USER"), parts: z.tuple([z.object({ data: payload }).strict()]), taskId: id.optional(), contextId: id.optional() }).strict(), configuration: z.object({ acceptedOutputModes: z.array(z.string()).optional(), returnImmediately: z.boolean().optional() }).strict().optional() }).strict();
const invoiceInput = z.object({ invoiceId: id }).strict();
const draftInput = z.object({ number: z.string().min(1).max(80), amount: z.string().regex(/^\d{1,9}(?:\.\d{1,6})?$/), customerEmail: z.email().max(254).optional(), dueDate: z.iso.date().optional() }).strict();
type Access = { enabled: number; skills: string; ens_tx?: string | null };
async function access(db: D1Database, merchant: string) { return db.prepare("SELECT enabled,skills,ens_tx FROM a2a_access WHERE merchant_id=?").bind(merchant).first<Access>(); }
const skillList = (a: Access | null) => { try { const v = JSON.parse(a?.skills ?? "[]"); return Array.isArray(v) ? SKILLS.filter(s => v.includes(s)) : []; } catch { return []; } };
export const a2aPublicRoutes = new Hono<AppEnv>();
a2aPublicRoutes.get("/.well-known/agent-card.json", c => c.json(agentCard(c.env.API_URL, "stenmont", "platform", SKILLS), 200, { "cache-control": "no-store" }));
a2aPublicRoutes.get("/a2a/:merchantId/agent-card.json", async c => {
  const mid = c.req.param("merchantId"); const a = await access(c.env.DB, mid);
  const [m] = await c.var.db.select().from(merchants).where(and(eq(merchants.id, mid), eq(merchants.status, "active")));
  if (!m || !a?.enabled) return fail(c, 404, "not_found", "Agent discovery is unavailable");
  return c.json(agentCard(c.env.API_URL, m.name, mid, skillList(a)), 200, { "cache-control": "no-store" });
});
export const agentAccessRoutes = new Hono<AppEnv>();
agentAccessRoutes.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.var.agentScopes !== undefined && !covers(parseScopes(c.var.agentScopes) ?? [], "write")) return fail(c, 403, "insufficient_scope", "Managing agent access requires write permission");
  return next();
});
agentAccessRoutes.get("/", async c => {
  const a = await access(c.env.DB, c.var.merchantId);
  const [ens] = await c.var.db.select().from(ensNames).where(eq(ensNames.merchantId, c.var.merchantId));
  return c.json({ enabled: !!a?.enabled, skills: skillList(a), availableSkills: SKILLS.map(id => ({ id, scope: scopeFor(id) })), cardUrl: `${c.env.API_URL}/a2a/${encodeURIComponent(c.var.merchantId)}/agent-card.json`, ens: { name: ens?.name ?? null, record: "stenmont.a2a", status: a?.ens_tx ? "published" : "publication_pending", txHash: a?.ens_tx ?? null } });
});
agentAccessRoutes.on(["PUT", "POST"], "/", bodyLimit({ maxSize: 4096, onError: c => c.json({ error: { code: "too_large" } }, 413) }), async c => {
  const parsed = z.object({ enabled: z.boolean(), skills: z.array(z.enum(SKILLS)).max(5) }).strict().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, 400, "invalid", "Choose only supported skills");
  await c.env.DB.prepare("INSERT INTO a2a_access (merchant_id,enabled,skills,updated_at) VALUES (?,?,?,?) ON CONFLICT(merchant_id) DO UPDATE SET enabled=excluded.enabled,skills=excluded.skills,updated_at=excluded.updated_at")
    .bind(c.var.merchantId, Number(parsed.data.enabled), JSON.stringify([...new Set(parsed.data.skills)]), c.var.now().toISOString()).run();
  return c.json({ ok: true });
});
agentAccessRoutes.post("/publish-ens", async c => {
  const a = await access(c.env.DB, c.var.merchantId);
  if (!a?.enabled) return fail(c, 409, "agent_disabled", "Enable agent access first");
  const [ens] = await c.var.db.select().from(ensNames).where(and(eq(ensNames.merchantId, c.var.merchantId), eq(ensNames.status, "active")));
  if (!ens) return fail(c, 409, "ens_required", "Claim an ENS name first");
  if (!(await hitRateLimit(c.var.db, `a2a:publish:${c.var.merchantId}`, 3, 3600, c.var.now()))) return fail(c, 429, "rate_limited", "Try again later");
  const cardUrl = `${c.env.API_URL}/a2a/${encodeURIComponent(c.var.merchantId)}/agent-card.json`;
  try {
    const txHash = await c.var.ens.setTextRecords({ name: ens.name, resolver: ens.resolver as Address, records: { [A2A_KEY]: cardUrl } });
    await c.env.DB.prepare("UPDATE a2a_access SET ens_tx=? WHERE merchant_id=?").bind(txHash, c.var.merchantId).run();
    return c.json({ record: A2A_KEY, value: cardUrl, txHash });
  } catch { return fail(c, 502, "ens_unavailable", "Registrar could not publish the discovery record"); }
});
export const a2aRoutes = new Hono<AppEnv>();
a2aRoutes.post("/:merchantId", bodyLimit({ maxSize: 16384, onError: c => c.json({ error: { code: "too_large" } }, 413) }), async c => {
  const mid = c.var.merchantId;
  if (![mid, "platform"].includes(c.req.param("merchantId"))) return fail(c, 403, "forbidden", "Use only the agent for your connected business");
  const a = await access(c.env.DB, mid);
  if (!a?.enabled) return fail(c, 403, "agent_disabled", "Agent access is disabled");
  let raw: unknown; try { raw = await c.req.json(); } catch { return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  const p = z.object({ jsonrpc: z.literal("2.0"), id: z.union([z.string().max(200), z.number().int()]), method: z.string(), params: object.default({}) }).strict().safeParse(raw);
  const rid = p.success ? p.data.id : null;
  const error = (code: number, message: string) => c.json({ jsonrpc: "2.0", id: rid, error: { code, message } });
  const result = (value: unknown) => c.json({ jsonrpc: "2.0", id: rid, result: value });
  if (!p.success) return error(-32600, "Invalid request");
  if (c.req.header("A2A-Version") !== "1.0") return error(-32009, "Use A2A-Version: 1.0");
  const { method, params } = p.data;
  if (["GetTask", "CancelTask"].includes(method)) {
    const parsed = z.object({ id, historyLength: z.number().int().min(0).max(100).optional() }).strict().safeParse(params);
    if (!parsed.success) return error(-32602, "Invalid task request");
    const row = await c.env.DB.prepare("SELECT task FROM a2a_tasks WHERE id=? AND merchant_id=? AND expires_at>?").bind(parsed.data.id, mid, c.var.now().toISOString()).first<{ task: string }>();
    if (!row) return error(-32001, "Task not found");
    if (method === "CancelTask") return error(-32002, "This synchronous task is already terminal");
    return result(JSON.parse(row.task));
  }
  if (["SendStreamingMessage", "SubscribeToTask"].includes(method)) return error(-32004, "Streaming is not supported");
  if (method.includes("PushNotification")) return error(-32003, "Push notifications are not supported");
  if (method !== "SendMessage") return error(-32601, "Method not found");
  const parsed = send.safeParse(params);
  if (!parsed.success) return error(-32602, "Send one structured data part with a supported skill and input");
  const { message } = parsed.data;
  if (message.taskId) {
    const existing = await c.env.DB.prepare("SELECT id FROM a2a_tasks WHERE id=? AND merchant_id=?").bind(message.taskId, mid).first();
    return existing ? error(-32004, "Terminal tasks cannot accept messages") : error(-32001, "Task not found");
  }
  const { skill, input } = message.parts[0].data;
  if (!skillList(a).includes(skill)) return fail(c, 403, "skill_disabled", "This skill is disabled");
  const granted = c.var.agentScopes;
  if (granted !== undefined && !covers(parseScopes(granted) ?? [], scopeFor(skill))) return fail(c, 403, "insufficient_scope", `This skill requires ${scopeFor(skill)} scope`);
  const hash = await sha256Hex(JSON.stringify(message));
  const prior = await c.env.DB.prepare("SELECT input_hash,task FROM a2a_tasks WHERE merchant_id=? AND message_id=?").bind(mid, message.messageId).first<{ input_hash: string; task: string }>();
  if (prior) return prior.input_hash === hash ? result({ task: JSON.parse(prior.task) }) : error(-32602, "Message id already used with different input");
  let data: unknown;
  if (skill === "create_invoice_draft") {
    const d = draftInput.safeParse(input); if (!d.success || toUnits(d.data.amount) <= 0n) return error(-32602, "Invalid draft fields");
    data = { ...d.data, currency: "USDT", requiresMerchantConfirmation: true, payable: false };
  } else if (skill === "check_invoice_status" || skill === "get_pay_link") {
    const d = invoiceInput.safeParse(input); if (!d.success) return error(-32602, "Supply invoiceId");
    const [row] = await c.var.db.select().from(invoices).where(and(eq(invoices.id, d.data.invoiceId), eq(invoices.merchantId, mid)));
    if (!row) return error(-32602, "Invoice unavailable");
    data = skill === "get_pay_link" ? { invoiceId: row.id, url: `${c.env.APP_URL}/pay/${row.id}` } : { invoiceId: row.id, status: row.status, amount: fromUnits(BigInt(row.amount)), amountPaid: fromUnits(BigInt(row.amountPaid)), currency: "USDT" };
  } else if (skill === "quote") {
    const d = z.object({ variantId: id, quantity: z.number().int().min(1).max(1000) }).strict().safeParse(input);
    if (!d.success) return error(-32602, "Supply variantId and quantity");
    const [row] = await c.var.db.select({ price: variants.price }).from(variants).innerJoin(products, eq(products.id, variants.productId)).where(and(eq(variants.id, d.data.variantId), eq(variants.merchantId, mid), eq(products.status, "active")));
    if (!row) return error(-32602, "Variant unavailable");
    data = { amount: fromUnits(BigInt(row.price) * BigInt(d.data.quantity)), currency: "USDT", indicative: true, payable: false };
  } else {
    if (Object.keys(input).length) return error(-32602, "Catalogue input must be empty");
    const rows = await c.var.db.select({ id: products.id, title: products.title, handle: products.handle }).from(products).where(and(eq(products.merchantId, mid), eq(products.status, "active"))).limit(50);
    data = { products: rows, limit: 50 };
  }
  const now = c.var.now();
  const task = { id: crypto.randomUUID(), contextId: message.contextId ?? crypto.randomUUID(), status: { state: "TASK_STATE_COMPLETED", timestamp: now.toISOString() }, artifacts: [{ artifactId: crypto.randomUUID(), parts: [{ data }] }] };
  // Atomic cap applies even to concurrent requests. No invoice, transaction, email or external write occurs here.
  const row = await c.env.DB.prepare("INSERT INTO a2a_tasks (id,merchant_id,message_id,input_hash,task,created_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM a2a_tasks WHERE merchant_id=? AND created_at>=?)<200 ON CONFLICT(merchant_id,message_id) DO NOTHING RETURNING id")
    .bind(task.id, mid, message.messageId, hash, JSON.stringify(task), now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString(), mid, now.toISOString().slice(0, 10)).first();
  if (!row) return fail(c, 429, "task_limit", "Task limit or concurrent duplicate; retrieve the original task");
  return result({ task });
});
