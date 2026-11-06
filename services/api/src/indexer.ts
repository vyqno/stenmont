import { and,eq,isNull,lte,sql } from "drizzle-orm";
import { fromUnits } from "@stenmont/shared";
import type { Db } from "./app";
import type { ChainClient, RouterLog } from "./chain";
import { chainCursor, invoices, payments, refunds } from "./db/schema";
import {invoiceProtocol,RETIRED_ROUTER,RETIRED_ROUTER_DEPLOY_BLOCK,type ContractVersion} from "./protocol";
import type { Env } from "./env";
import { invoiceView } from "./lib/views";
import { emitEvent } from "./webhooks";

const CURSOR = "router";
const MAX_WINDOW = 2000n;

export type IndexerResult =
  | { status: "ok"; from: bigint; to: bigint; logs: number }
  | { status: "idle" }
  | { status: "error"; error: string };

/**
 * Reads PaymentRouter events in windows of at most 2000 blocks, a few confirmations behind the head, and applies them.
 * Safe to re-run over the same blocks: payments are unique per (tx, log index), webhook deliveries are unique per
 * event, and invoice totals only ever move forward. The cursor only advances after a window is fully applied.
 */
export async function runIndexer(env: Env, db: Db, chain: ChainClient,version:ContractVersion="v1",routerOverride?:`0x${string}`): Promise<IndexerResult> {
  try {
    const protocol=invoiceProtocol(env,{contractVersion:version,...(routerOverride?{routerAddress:routerOverride}:{})});
    const cursor=version==='v1'&&!routerOverride?CURSOR:`router:${env.WHITECHAIN_CHAIN_ID}:${protocol.router.toLowerCase()}`;
    const deploy=routerOverride?.toLowerCase()===RETIRED_ROUTER.toLowerCase()?RETIRED_ROUTER_DEPLOY_BLOCK:version==='v1'?env.ROUTER_DEPLOY_BLOCK:env.ROUTER_V2_DEPLOY_BLOCK;
    if(!deploy)throw Error('Missing router deployment block');
    const [cur] = await db.select().from(chainCursor).where(eq(chainCursor.name, cursor));
    const last = BigInt(cur?.lastBlock ?? Number(deploy) - 1);
    const head = await chain.getBlockNumber();
    const safe = head - BigInt(env.INDEXER_CONFIRMATIONS ?? "2");
    await recoverCreations(env,db,chain,version,protocol.router,BigInt(deploy),safe);
    const from = last + 1n;
    if (from > safe) return { status: "idle" };
    const to = safe < from + MAX_WINDOW - 1n ? safe : from + MAX_WINDOW - 1n;

    const logs = (await chain.getRouterLogs(from, to)).sort(
      (a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex,
    );
    for (const log of logs){
      const args=[Number(env.WHITECHAIN_CHAIN_ID),protocol.router.toLowerCase(),log.transactionHash,log.logIndex];
      const seen=await env.DB.prepare('SELECT 1 FROM protocol_events WHERE chain_id=? AND contract_address=? AND tx_hash=? AND log_index=?').bind(...args).first();
      if(seen)continue;
      await apply(env,db,log,chain,version,protocol.router);
      await env.DB.prepare('INSERT OR IGNORE INTO protocol_events VALUES(?,?,?,?)').bind(...args).run();
    }

    await db
      .insert(chainCursor)
      .values({ name: cursor, lastBlock: Number(to) })
      .onConflictDoUpdate({ target: chainCursor.name, set: { lastBlock: Number(to) } });
    return { status: "ok", from, to, logs: logs.length };
  } catch (e) {
    console.error("indexer failed", e);
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

const eventId = (l: RouterLog) => `evt_${l.transactionHash}_${l.logIndex}`;

async function apply(env: Env, db: Db, log: RouterLog,chain:ChainClient,version:ContractVersion,sourceRouter:string): Promise<void> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, log.args.id));
  if (!inv||inv.contractVersion!==version) return; // not this contract's obligation
  const protocol=invoiceProtocol(env,inv);
  if(protocol.router.toLowerCase()!==sourceRouter.toLowerCase())return;
  if(log.eventName==='InvoiceCreated'||log.eventName==='DiscountTermsSet'){
    if(!chain.invoiceDetails)throw Error('Storage read required for invoice terms');
    const d=await chain.invoiceDetails(log.args.id,log.blockNumber);
    if(inv.payout&&inv.payout.toLowerCase()!==d.payout.toLowerCase())throw Error("Payout provenance mismatch");
    await db.update(invoices).set({routerAddress:inv.routerAddress??protocol.router,claimAddress:inv.claimAddress??(protocol.retired?null:protocol.claim),payout:inv.payout??d.payout,payerLock:d.payerLock,minPayment:d.minPayment.toString(),discountBps:d.discountBps,discountUntil:Number(d.discountUntil),hook:d.hook}).where(eq(invoices.id,inv.id));
    if(log.eventName==='InvoiceCreated')await confirmCreation(env,db,chain,log,version,sourceRouter);
    return;
  }
  const now = new Date().toISOString();

  if (log.eventName === "InvoicePaid") {
    await db
      .insert(payments)
      .values({
        id: crypto.randomUUID(),
        invoiceId: inv.id,
        payer: log.args.payer,
        value: log.args.value.toString(),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        createdAt: now,
      })
      .onConflictDoNothing();
    if (log.args.paidTotal > BigInt(inv.amountPaid)) {
      const status = log.args.fullyPaid ? "paid" : inv.status === "cancelled" ? "cancelled" : "partially_paid";
      await db.update(invoices).set({ amountPaid: log.args.paidTotal.toString(), status, updatedAt: now }).where(eq(invoices.id, inv.id));
    }
    const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    await emitEvent(db, env.WEBHOOKS, inv.merchantId, {
      id: eventId(log),
      type: log.args.fullyPaid ? "invoice.paid" : "invoice.partially_paid",
      data: {
        invoice: invoiceView(fresh!, env),
        payment: { payer: log.args.payer, value: fromUnits(log.args.value), txHash: log.transactionHash, blockNumber: Number(log.blockNumber) },
      },
    });
    return;
  }

  if (log.eventName === "InvoiceRefunded") {
    await db
      .insert(refunds)
      .values({
        id: crypto.randomUUID(),
        invoiceId: inv.id,
        toAddress: log.args.to,
        value: log.args.value.toString(),
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: Number(log.blockNumber),
        createdAt: now,
      })
      .onConflictDoNothing();
    if (log.args.refundedTotal > BigInt(inv.amountRefunded)) {
      await db.update(invoices).set({ amountRefunded: log.args.refundedTotal.toString(), updatedAt: now }).where(eq(invoices.id, inv.id));
    }
    const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    await emitEvent(db, env.WEBHOOKS, inv.merchantId, {
      id: eventId(log),
      type: "refund.created",
      data: {
        invoice: invoiceView(fresh!, env),
        refund: { to: log.args.to, value: fromUnits(log.args.value), txHash: log.transactionHash },
      },
    });
    return;
  }

  // InvoiceCancelled: only an unpaid invoice becomes cancelled; a paid one stays paid
  if (inv.status === "open" || inv.status === "partially_paid") {
    await db.update(invoices).set({ status: "cancelled", updatedAt: now }).where(eq(invoices.id, inv.id));
  }
  const [fresh] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
  await emitEvent(db, env.WEBHOOKS, inv.merchantId, {
    id: eventId(log),
    type: "invoice.cancelled",
    data: { invoice: invoiceView(fresh!, env) },
  });
}

/** Confirm only an exact successful creation on the invoice's saved contract. No re-signing or broadcast. */
async function confirmCreation(env:Env,db:Db,chain:ChainClient,log:RouterLog,version:ContractVersion,sourceRouter:string):Promise<void>{
  if(log.eventName!=='InvoiceCreated'||!log.address||log.address.toLowerCase()!==sourceRouter.toLowerCase()||!chain.invoiceDetails||!chain.lookupReceipt)return;
  const [inv]=await db.select().from(invoices).where(and(eq(invoices.id,log.args.id),eq(invoices.status,'creating'),isNull(invoices.createTxHash)));
  if(!inv||inv.contractVersion!==version||!inv.routerAddress||inv.routerAddress.toLowerCase()!==sourceRouter.toLowerCase())return;
  invoiceProtocol(env,inv); // do not infer an unassigned or mismatched router
  const state=await chain.invoiceDetails(log.args.id);
  if(state.status!==1||state.paid!==0n||state.amount!==BigInt(inv.amount)||!inv.payout||state.payout.toLowerCase()!==inv.payout.toLowerCase())return;
  const receipt=await chain.lookupReceipt(log.transactionHash);
  if(!receipt||receipt.status!=='success')return;
  const updated=await db.update(invoices).set({status:'open',createTxHash:log.transactionHash,updatedAt:new Date().toISOString()})
    .where(and(eq(invoices.id,inv.id),eq(invoices.status,'creating'),isNull(invoices.createTxHash))).returning();
  if(updated.length)await emitEvent(db,env.WEBHOOKS,inv.merchantId,{id:`evt_created_${inv.id}`,type:'invoice.created',data:{invoice:invoiceView(updated[0]!,env)}});
}

/** A journalled event may have outlived its disconnected HTTP request. Revisit at most20 stale rows and2000 confirmed blocks. */
async function recoverCreations(env:Env,db:Db,chain:ChainClient,version:ContractVersion,router:string,deploy:bigint,safe:bigint):Promise<void>{
  if(!chain.invoiceDetails||!chain.lookupReceipt||safe<deploy)return;
  const stale=new Date(Date.now()-60_000).toISOString();
  const rows=await db.select().from(invoices).where(and(eq(invoices.contractVersion,version),eq(invoices.status,'creating'),isNull(invoices.createTxHash),lte(invoices.updatedAt,stale),sql`lower(${invoices.routerAddress}) = ${router.toLowerCase()}`)).orderBy(invoices.updatedAt).limit(20);
  if(!rows.length)return;
  const from=safe-MAX_WINDOW+1n>deploy?safe-MAX_WINDOW+1n:deploy;
  const logs=await chain.getRouterLogs(from,safe);
  for(const row of rows){
    const log=logs.find(l=>l.eventName==='InvoiceCreated'&&l.args.id.toLowerCase()===row.id.toLowerCase()&&l.address?.toLowerCase()===router.toLowerCase()&&l.blockNumber>=from&&l.blockNumber<=safe);
    if(!log)continue;
    try{await confirmCreation(env,db,chain,log,version,router);}catch{console.warn('Creation recovery could not confirm a row; leaving it unchanged.');}
  }
}
