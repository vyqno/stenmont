import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { CLAIM_LIMITS, fromUnits, invoiceClaimAbi } from "@stenmont/shared";
import type { Db } from "./app";
import type { ChainClient, ClaimLog } from "./chain";
import { chainCursor, claims } from "./db/schema";
import type { Env } from "./env";
import { sendFromTank } from "./relayer/tankSend";
import { emitEvent } from "./webhooks";

export type ClaimRow = typeof claims.$inferSelect;
const CURSOR = "claims";
const MAX_WINDOW = 2000n;
/** A claim sits in `funding` only while one request is sending the transaction; after this long, the chain is trusted over the lock. */
const FUNDING_LOCK_SECONDS = 600;
const DEFAULT_BATCH = 10;
const LEASE_SECONDS = 600;

const iso = (s: number) => new Date(s * 1000).toISOString();

/** What the merchant sees (and what claim.* webhooks carry). */
export function claimView(r: ClaimRow) {
  const face = BigInt(r.face);
  const price = BigInt(r.price);
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    status: r.status,
    face: fromUnits(face),
    price: fromUnits(price),
    reserve: fromUnits(BigInt(r.reserve)),
    advance: fromUnits(price - BigInt(r.reserve)),
    discountBps: r.discountBps,
    reserveBps: r.reserveBps,
    dueDate: iso(r.dueDate),
    fundBy: iso(r.deadline),
    investor: r.investor,
    listTxHash: r.listTxHash,
    fundTxHash: r.fundTxHash,
    closeTxHash: r.closeTxHash,
  };
}

/** The live row for an invoice: any row that is past the signing step wins over a request still waiting for signatures. */
export async function liveClaim(db: Db, invoiceId: string): Promise<ClaimRow | null> {
  const rows = await db.select().from(claims).where(eq(claims.invoiceId, invoiceId));
  return rows.find((r) => r.status !== "pending") ?? rows[0] ?? null;
}

const eventId = (type: "funded" | "settled" | "defaulted", invoiceId: string) => `evt_claim_${type}_${invoiceId}`;

async function announce(env: Env, db: Db, row: ClaimRow, type: "funded" | "settled" | "defaulted", txHash?: string) {
  const [fresh] = await db.select().from(claims).where(eq(claims.id, row.id));
  // one event id per claim and kind: the indexer, the default job and a re-run over the same blocks can never double-send
  await emitEvent(db, env.WEBHOOKS, row.merchantId, { id: eventId(type, row.invoiceId), type: `claim.${type}`, data: { claim: claimView(fresh!), ...(txHash ? { txHash } : {}) } });
}

export type ClaimIndexerResult = { status: "ok"; from: bigint; to: bigint; logs: number } | { status: "idle" } | { status: "error"; error: string };

/**
 * Mirrors InvoiceClaim events into `claims`. Forward-only (a status never moves back), so re-running over the same
 * blocks changes nothing and sends no second webhook. The cursor only advances after a window is fully applied.
 */
export async function runClaimIndexer(env: Env, db: Db, chain: ChainClient, now = new Date()): Promise<ClaimIndexerResult> {
  if (!env.INVOICE_CLAIM_ADDRESS) return { status: "idle" };
  try {
    // a funding lock that outlived its request means the transaction never landed (or the event will say otherwise)
    const stale = new Date(now.getTime() - FUNDING_LOCK_SECONDS * 1000).toISOString();
    await db.update(claims).set({ status: "listed" }).where(and(eq(claims.status, "funding"), lt(claims.updatedAt, stale)));

    const [cur] = await db.select().from(chainCursor).where(eq(chainCursor.name, CURSOR));
    const last = BigInt(cur?.lastBlock ?? Number(env.ROUTER_DEPLOY_BLOCK) - 1);
    const safe = (await chain.getBlockNumber()) - BigInt(env.INDEXER_CONFIRMATIONS ?? "2");
    const from = last + 1n;
    if (from > safe) return { status: "idle" };
    const to = safe < from + MAX_WINDOW - 1n ? safe : from + MAX_WINDOW - 1n;
    const logs = (await chain.getClaimLogs(from, to)).sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
    for (const log of logs) await apply(env, db, log, now);
    await db.insert(chainCursor).values({ name: CURSOR, lastBlock: Number(to) }).onConflictDoUpdate({ target: chainCursor.name, set: { lastBlock: Number(to) } });
    return { status: "ok", from, to, logs: logs.length };
  } catch (e) {
    console.error("claim indexer failed", e);
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

const BEFORE_FUND = ["pending", "sending", "listed", "funding"];

async function apply(env: Env, db: Db, log: ClaimLog, now: Date): Promise<void> {
  const stamp = now.toISOString();
  const set = async (row: ClaimRow, from: string[], patch: Partial<ClaimRow>) => {
    const moved = await db.update(claims).set({ ...patch, updatedAt: stamp }).where(and(eq(claims.id, row.id), inArray(claims.status, from))).returning({ id: claims.id });
    return moved.length > 0;
  };
  const invoiceId = (log.eventName === "Transfer" ? `0x${log.args.tokenId.toString(16).padStart(64, "0")}` : log.args.invoiceId).toLowerCase();
  const row = await liveClaim(db, invoiceId);
  if (!row) return; // not one of ours

  switch (log.eventName) {
    case "ClaimListed":
      await set(row, ["pending", "sending"], { status: "listed", listTxHash: log.transactionHash, listedAt: stamp });
      return;
    case "ClaimFunded":
      await set(row, BEFORE_FUND, { status: "funded", investor: log.args.investor.toLowerCase(), fundTxHash: log.transactionHash, fundedAt: stamp });
      await announce(env, db, row, "funded", log.transactionHash);
      return;
    case "Transfer":
      // a sale of the claim from one allowlisted investor to another (the mint is covered by ClaimFunded)
      if (log.args.from !== "0x0000000000000000000000000000000000000000") await set(row, ["funded", "defaulted"], { investor: log.args.to.toLowerCase() });
      return;
    case "ClaimSettled":
      await set(row, [...BEFORE_FUND, "funded"], { status: "settled", closeTxHash: log.transactionHash, closedAt: stamp });
      await announce(env, db, row, "settled", log.transactionHash);
      return;
    case "ClaimDefaulted":
      await set(row, [...BEFORE_FUND, "funded"], { status: "defaulted", closeTxHash: log.transactionHash, closedAt: stamp });
      await announce(env, db, row, "defaulted", log.transactionHash);
      return;
    case "ClaimCancelled":
      await set(row, ["pending", "sending", "listed"], { status: "cancelled" });
      return;
  }
}

/**
 * Hourly: marks every funded claim that is more than the 7-day grace past its due date as defaulted (the reserve then
 * goes to the investor, once). Each claim is leased so overlapping runs cannot both send, the contract refuses a second
 * default, and our own problems (empty gas tank, RPC error) just leave the claim for the next run.
 */
export async function runDefaults(env: Env, db: Db, chain: ChainClient, now: Date, batch = DEFAULT_BATCH): Promise<{ defaulted: number }> {
  if (!env.INVOICE_CLAIM_ADDRESS) return { defaulted: 0 };
  const nowS = Math.floor(now.getTime() / 1000);
  // a minute of slack so the chain clock is certainly past the grace period
  const overdue = nowS - CLAIM_LIMITS.graceSeconds - 60;
  const due = await db.select().from(claims).where(and(eq(claims.status, "funded"), lt(claims.dueDate, overdue + 1), or(isNull(claims.leaseUntil), lte(claims.leaseUntil, nowS)))).limit(batch);
  let defaulted = 0;
  for (const row of due) {
    const leased = await db
      .update(claims)
      .set({ leaseUntil: nowS + LEASE_SECONDS })
      .where(and(eq(claims.id, row.id), eq(claims.status, "funded"), or(isNull(claims.leaseUntil), lte(claims.leaseUntil, nowS))))
      .returning({ id: claims.id });
    if (leased.length === 0) continue;
    const data = encodeFunctionData({ abi: invoiceClaimAbi, functionName: "markDefault", args: [row.invoiceId as Hex] });
    const sent = await sendFromTank({ db, chain, now }, row.merchantId, { to: env.INVOICE_CLAIM_ADDRESS as Address, data });
    let txHash: string | undefined = sent.ok ? sent.txHash : undefined;
    if (!sent.ok && !(sent.code === "rejected" && (sent.reason === "NotFunded" || sent.reason === "GraceNotOver"))) continue; // our side, or already in flight: next run
    if (!sent.ok && sent.code === "rejected" && sent.reason === "GraceNotOver") continue;
    // The contract is the source of truth: take whatever it says now (default, or settled/defaulted by someone else).
    const st = await chain.claimState(row.invoiceId as Hex);
    const status = st.status === "defaulted" || st.status === "settled" ? st.status : null;
    if (!status) continue;
    const moved = await db.update(claims).set({ status, leaseUntil: null, closedAt: now.toISOString(), ...(txHash ? { closeTxHash: txHash } : {}), updatedAt: now.toISOString() }).where(and(eq(claims.id, row.id), eq(claims.status, "funded"))).returning({ id: claims.id });
    if (moved.length > 0) {
      if (status === "defaulted") defaulted++;
      await announce(env, db, row, status, txHash);
    }
  }
  return { defaulted };
}
