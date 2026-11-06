import { and, eq } from "drizzle-orm";
import type { Address } from "viem";
import type { Db } from "../app";
import { audit } from "../audit";
import { ensDirectory, ensNames, merchants, siteChecks, sites } from "../db/schema";
import { loadFacts, loadLimits } from "../verification/store";
import { computeTier } from "../verification/tiers";
import { buildDirectory, diffDirectory, type Directory, type Omission } from "./directory";
import type { EnsClient } from "./client";

type Deps = { db: Db; ens: EnsClient; now: Date; chainId: number; usdt: Address };
/** What a business may set. `undefined` keeps what is stored, `null` clears it. */
export type DirectoryInput = { payUrl?: string | null; x402Url?: string | null; refund?: string | null };
export type PublishResult = {
  status: "published" | "unchanged" | "no_name" | "failed";
  name?: string;
  records: Directory["records"];
  omitted: Omission[];
  txHash?: string;
};

type Row = typeof ensDirectory.$inferSelect;

/** Everything that decides the record set, from facts we hold. Shared by publish, the preview and the hourly job. */
export async function planDirectory(deps: Pick<Deps, "db" | "now" | "chainId" | "usdt">, merchantId: string, row: Pick<Row, "payUrl" | "x402Url" | "refund">): Promise<Directory> {
  const { db, now } = deps;
  const facts = await loadFacts(db, merchantId);
  const { tier } = computeTier(facts, now);
  const limits = await loadLimits(db);
  const hosts = await db
    .select({ host: sites.host })
    .from(siteChecks)
    .innerJoin(sites, eq(sites.id, siteChecks.siteId))
    .where(and(eq(sites.merchantId, merchantId), eq(siteChecks.kind, "domain"), eq(siteChecks.ok, 1)));
  return buildDirectory({
    chainId: deps.chainId,
    usdt: deps.usdt,
    perInvoice: limits[tier]!.perInvoice,
    verifiedHosts: hosts.map((h) => h.host),
    payUrl: row.payUrl,
    x402Url: row.x402Url,
    refund: row.refund,
  });
}

/**
 * Writes the business's pay directory to its ENS name: its saved inputs plus what we derive (token, cap). Only what changed
 * is written, in one transaction. Safe to repeat. A failed chain write keeps the inputs and records nothing as published.
 */
export async function publishDirectory(deps: Deps, merchantId: string, input: DirectoryInput = {}): Promise<PublishResult> {
  const { db, ens, now } = deps;
  const [name] = await db.select().from(ensNames).where(eq(ensNames.merchantId, merchantId));
  if (!name || name.status !== "active") return { status: "no_name", records: {}, omitted: [] };

  const [prior] = await db.select().from(ensDirectory).where(eq(ensDirectory.merchantId, merchantId));
  const saved = {
    payUrl: input.payUrl === undefined ? (prior?.payUrl ?? null) : input.payUrl,
    x402Url: input.x402Url === undefined ? (prior?.x402Url ?? null) : input.x402Url,
    refund: input.refund === undefined ? (prior?.refund ?? null) : input.refund,
    updatedAt: now.toISOString(),
  };
  await db.insert(ensDirectory).values({ merchantId, ...saved }).onConflictDoUpdate({ target: ensDirectory.merchantId, set: saved });

  const plan = await planDirectory(deps, merchantId, saved);
  const published = JSON.parse(prior?.published ?? "{}") as Record<string, string>;
  const toWrite = diffDirectory(published, plan.records);
  if (Object.keys(toWrite).length === 0) return { status: "unchanged", name: name.name, ...plan };

  try {
    const txHash = await ens.setTextRecords({ name: name.name, resolver: name.resolver as Address, records: toWrite });
    await db.update(ensDirectory).set({ published: JSON.stringify(plan.records), txHash, publishedAt: now.toISOString() }).where(eq(ensDirectory.merchantId, merchantId));
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "ens.directory_published", payload: { name: name.name, written: Object.keys(toWrite), txHash } });
    return { status: "published", name: name.name, ...plan, ...(txHash ? { txHash } : {}) };
  } catch (e) {
    console.error("directory publish failed", e);
    // For example a name whose payout was locked before the directory existed: its registrar can no longer write these keys.
    await audit(db, { merchantId, actor: `merchant:${merchantId}`, action: "ens.directory_failed", payload: { name: name.name, keys: Object.keys(toWrite) } });
    return { status: "failed", name: name.name, ...plan };
  }
}

/** Hourly: re-derives the directory of every business that has published, so the cap follows its tier up and down. */
// ponytail: same bounded walk as the tier badge job; page by last attempt if thousands of businesses publish.
export async function runDirectoryRefresh(deps: Deps, limit = 20): Promise<{ published: number; failed: number }> {
  const rows = await deps.db
    .select({ id: ensDirectory.merchantId })
    .from(ensDirectory)
    .innerJoin(ensNames, eq(ensNames.merchantId, ensDirectory.merchantId))
    .innerJoin(merchants, eq(merchants.id, ensDirectory.merchantId))
    .where(and(eq(ensNames.status, "active"), eq(merchants.status, "active")))
    .orderBy(ensDirectory.updatedAt);
  let published = 0;
  let failed = 0;
  for (const { id } of rows) {
    if (published + failed >= limit) break;
    const r = await publishDirectory(deps, id);
    if (r.status === "published") published++;
    if (r.status === "failed") failed++;
  }
  return { published, failed };
}
