import { and, eq, lt } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../app";
import { invoices, payments, refunds, claims, relayerTxs } from "../db/schema";
import { periodBounds, type Input } from "./reconcile";

/** Every source query is merchant-scoped. First observation preserves late/backdated events as future adjustments. */
export async function loadBooks(c:Context<AppEnv>,period:string, cutoff?:string):Promise<Input> {
  const db=c.var.db, merchant=c.var.merchantId, end=cutoff??periodBounds(period).end;
  const inv=await db.select().from(invoices).where(eq(invoices.merchantId,merchant));
  const pay=await db.select({event:payments}).from(payments).innerJoin(invoices,eq(invoices.id,payments.invoiceId)).where(and(eq(invoices.merchantId,merchant),lt(payments.createdAt,end)));
  const ref=await db.select({event:refunds}).from(refunds).innerJoin(invoices,eq(invoices.id,refunds.invoiceId)).where(and(eq(invoices.merchantId,merchant),lt(refunds.createdAt,end)));
  const claim=await db.select().from(claims).where(eq(claims.merchantId,merchant));
  const gas=await db.select().from(relayerTxs).where(eq(relayerTxs.merchantId,merchant));
  if ([inv,pay,ref,claim,gas].some(rows=>rows.length>20000)) throw new Error("Books source exceeds 20000 rows; narrow the source before closing");
  const closes=await c.env.DB.prepare("SELECT period,closed_at FROM books_closes WHERE merchant_id=?").bind(merchant).all<{period:string;closed_at:string}>();
  const closedPeriods=Object.fromEntries(closes.results.map(r=>[r.period,r.closed_at]));
  const now=c.var.now().toISOString();
  // One observation time per event, retained even when the month has not yet been closed.
  const ids=[...pay.map(r=>({id:`pay:${r.event.id}`,at:r.event.createdAt})),...ref.map(r=>({id:`refund:${r.event.id}`,at:r.event.createdAt})),
    ...claim.flatMap(r=>[...(r.fundTxHash&&r.fundedAt?[{id:`fund:${r.id}:${r.fundTxHash}`,at:r.fundedAt}]:[]),...(r.closeTxHash&&r.closedAt?[{id:`close:${r.id}:${r.closeTxHash}`,at:r.closedAt}]:[])]),
    ...gas.filter(r=>r.wbtCost).map(r=>({id:`gas:${r.id}`,at:r.updatedAt}))];
  const observedAt=(at:string)=>closedPeriods[at.slice(0,7)] && now<=closedPeriods[at.slice(0,7)]! ? new Date(Date.parse(closedPeriods[at.slice(0,7)]!)+1).toISOString() : now;
  for(let offset=0;offset<ids.length;offset+=80) await c.env.DB.batch(ids.slice(offset,offset+80).map(({id,at})=>c.env.DB.prepare("INSERT OR IGNORE INTO books_observed_events(merchant_id,source_id,observed_at) VALUES(?,?,?)").bind(merchant,id,observedAt(at))));
  const observations=await c.env.DB.prepare("SELECT source_id,observed_at FROM books_observed_events WHERE merchant_id=?").bind(merchant).all<{source_id:string;observed_at:string}>();
  const observed=new Map(observations.results.map(r=>[r.source_id,r.observed_at]));
  return {period,closedPeriods,
    invoices:inv.map(r=>({...r,amount:BigInt(r.amount)})),
    payments:pay.map(({event:r})=>({...r,value:BigInt(r.value),at:r.createdAt,recordedAt:observed.get(`pay:${r.id}`)})),
    refunds:ref.map(({event:r})=>({...r,to:r.toAddress,value:BigInt(r.value),at:r.createdAt,recordedAt:observed.get(`refund:${r.id}`)})),
    claims:claim.filter(r=>!r.fundedAt||r.fundedAt<end).map(r=>({...r,face:BigInt(r.face),price:BigInt(r.price),reserve:BigInt(r.reserve),fundRecordedAt:observed.get(`fund:${r.id}:${r.fundTxHash}`),closeRecordedAt:observed.get(`close:${r.id}:${r.closeTxHash}`)})),
    gas:gas.filter(r=>r.wbtCost&&["success","reverted"].includes(r.status)&&r.updatedAt<end).map(r=>({id:r.id,txHash:r.txHash,kind:r.kind,wei:BigInt(r.wbtCost!),at:r.updatedAt,recordedAt:observed.get(`gas:${r.id}`)})),
  };
}
