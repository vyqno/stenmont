import { and, eq, lt } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../app";
import { invoices, payments, refunds, claims, relayerTxs, instalmentCharges } from "../db/schema";
import { periodBounds, type Input } from "./reconcile";

/** Every source query is merchant-scoped. First observation preserves late/backdated events as future adjustments. */
export async function loadBooks(c:Context<AppEnv>,period:string, cutoff?:string):Promise<Input> {
  const db=c.var.db, merchant=c.var.merchantId, end=cutoff??periodBounds(period).end;
  const inv=await db.select().from(invoices).where(eq(invoices.merchantId,merchant));
  const pay=await db.select({event:payments}).from(payments).innerJoin(invoices,eq(invoices.id,payments.invoiceId)).where(and(eq(invoices.merchantId,merchant),lt(payments.createdAt,end)));
  const ref=await db.select({event:refunds}).from(refunds).innerJoin(invoices,eq(invoices.id,refunds.invoiceId)).where(and(eq(invoices.merchantId,merchant),lt(refunds.createdAt,end)));
  const claim=await db.select().from(claims).where(eq(claims.merchantId,merchant));
  const instalments=await db.select().from(instalmentCharges).where(and(eq(instalmentCharges.merchantId,merchant),lt(instalmentCharges.observedAt,end)));
  const gas=await db.select().from(relayerTxs).where(eq(relayerTxs.merchantId,merchant));
  if ([inv,pay,ref,claim,gas,instalments].some(rows=>rows.length>20000)) throw new Error("Books source exceeds 20000 rows; narrow the source before closing");
  const closes=await c.env.DB.prepare("SELECT period,closed_at,bundle FROM books_closes WHERE merchant_id=?").bind(merchant).all<{period:string;closed_at:string;bundle:string}>();
  const allocations=new Map<string,string>();
  for (const row of closes.results) {
    const members=JSON.parse(row.bundle).snapshot.bookedSourceIds;
    if(!Array.isArray(members)) throw new Error("books_close_membership_unavailable");
    for (const key of members) allocations.set(key,row.period);
  }
  const closedPeriods=Object.fromEntries(closes.results.map(r=>[r.period,r.closed_at]));
  const now=c.var.now().toISOString();
  // One observation time per event, retained even when the month has not yet been closed.
  const ids=[...instalments.flatMap(r=>[{id:`instalment:${r.id}`,at:r.observedAt},...(r.gasCostWbt?[{id:`instalment-gas:${r.id}`,at:r.observedAt}]:[])]),...pay.map(r=>({id:`pay:${r.event.id}`,at:r.event.createdAt})),...ref.map(r=>({id:`refund:${r.event.id}`,at:r.event.createdAt})),
    ...claim.flatMap(r=>[...(r.fundTxHash&&r.fundedAt?[{id:`fund:${r.id}:${r.fundTxHash}`,at:r.fundedAt}]:[]),...(r.closeTxHash&&r.closedAt?[{id:`close:${r.id}:${r.closeTxHash}`,at:r.closedAt}]:[])]),
    ...gas.filter(r=>r.wbtCost).map(r=>({id:`gas:${r.id}`,at:r.updatedAt}))];
  const observedAt=(at:string)=>closedPeriods[at.slice(0,7)] && now<=closedPeriods[at.slice(0,7)]! ? new Date(Date.parse(closedPeriods[at.slice(0,7)]!)+1).toISOString() : now;
  for(let offset=0;offset<ids.length;offset+=80) await c.env.DB.batch(ids.slice(offset,offset+80).map(({id,at})=>c.env.DB.prepare("INSERT OR IGNORE INTO books_observed_events(merchant_id,source_id,observed_at) VALUES(?,?,?)").bind(merchant,id,observedAt(at))));
  const observations=await c.env.DB.prepare("SELECT source_id,observed_at FROM books_observed_events WHERE merchant_id=?").bind(merchant).all<{source_id:string;observed_at:string}>();
  const observed=new Map(observations.results.map(r=>[r.source_id,r.observed_at]));
  const measuredGas = new Map<string, Input["gas"][number]>();
  for (const r of gas) {
    if (!r.txHash || !r.wbtCost || !["success","reverted"].includes(r.status) || r.updatedAt >= end) continue;
    const key=r.txHash.toLowerCase();
    if (!measuredGas.has(key)) measuredGas.set(key,{id:r.id,txHash:r.txHash,kind:r.kind,wei:BigInt(r.wbtCost),at:r.updatedAt,recordedAt:observed.get(`gas:${r.id}`)});
  }
  for (const r of instalments) {
    const key=r.txHash.toLowerCase();
    if (measuredGas.has(key)) {
      const existing=measuredGas.get(key)!;
      // The immutable charge receipt remains the event date even if a matching relayer row is finalized later.
      measuredGas.set(key,{...existing,at:r.observedAt,recordedAt:r.gasCostWbt?observed.get(`instalment-gas:${r.id}`):existing.recordedAt});
    } else if (r.gasCostWbt) measuredGas.set(key,{id:`instalment-gas:${r.id}`,txHash:r.txHash,kind:"replacement_instalment",wei:BigInt(r.gasCostWbt),at:r.observedAt,recordedAt:observed.get(`instalment-gas:${r.id}`)});
  }
  const input:Input = {period,closedPeriods,
    invoices:inv.map(r=>({...r,amount:BigInt(r.amount)})),
    payments:[...pay.map(({event:r})=>({...r,value:BigInt(r.value),at:r.createdAt,recordedAt:observed.get(`pay:${r.id}`)})),
      ...instalments.map(r=>({id:`instalment:${r.id}`,invoiceId:r.invoiceId,payer:r.payer,value:BigInt(r.amount),txHash:r.txHash,at:r.observedAt,recordedAt:observed.get(`instalment:${r.id}`),sourceKey:`instalment:${r.id}`,rail:"replacement_subscription" as const,agreementId:r.agreementId}))],
    refunds:ref.map(({event:r})=>({...r,to:r.toAddress,value:BigInt(r.value),at:r.createdAt,recordedAt:observed.get(`refund:${r.id}`)})),
    claims:claim.filter(r=>!r.fundedAt||r.fundedAt<end).map(r=>({...r,face:BigInt(r.face),price:BigInt(r.price),reserve:BigInt(r.reserve),fundRecordedAt:observed.get(`fund:${r.id}:${r.fundTxHash}`),closeRecordedAt:observed.get(`close:${r.id}:${r.closeTxHash}`)})),
    gas:[...measuredGas.values()].map(g=>({...g,sourceKey:`gas-tx:${g.txHash!.toLowerCase()}`})),
  };
  // Booked membership wins over timing inference. A preview may observe a row after the close's source read
  // but before its INSERT commits: absence from the signed membership must still make that row an adjustment.
  const allocation=(key:string,at:string,recordedAt?:string)=>{
    let bookedPeriod=allocations.get(key);
    const sourceMonth=at.slice(0,7),close=closedPeriods[sourceMonth];
    if (!bookedPeriod && close) {
      if (!recordedAt || recordedAt<=close) recordedAt=new Date(Date.parse(close)+1).toISOString();
      let candidate=recordedAt.slice(0,7)>sourceMonth?recordedAt.slice(0,7):periodBounds(sourceMonth).end.slice(0,7);
      // No signed bundle contains this source: every already-closed candidate is unavailable, irrespective of clock order.
      while(closedPeriods[candidate]) candidate=periodBounds(candidate).end.slice(0,7);
      bookedPeriod=candidate;
    }
    return {bookedPeriod,recordedAt};
  };
  for(const r of input.payments) Object.assign(r,allocation(r.sourceKey??`pay:${r.id}`,r.at,r.recordedAt));
  for(const r of input.refunds) Object.assign(r,allocation(r.sourceKey??`refund:${r.id}`,r.at,r.recordedAt));
  for(const g of input.gas) Object.assign(g,allocation(g.sourceKey!,g.at,g.recordedAt));
  for(const c of input.claims){
    if(c.fundedAt){const a=allocation(`fund:${c.id}:${c.fundTxHash}`,c.fundedAt,c.fundRecordedAt);c.fundBookedPeriod=a.bookedPeriod;c.fundRecordedAt=a.recordedAt;}
    if(c.closedAt){const a=allocation(`close:${c.id}:${c.closeTxHash}`,c.closedAt,c.closeRecordedAt);c.closeBookedPeriod=a.bookedPeriod;c.closeRecordedAt=a.recordedAt;}
  }
  return input;
}
