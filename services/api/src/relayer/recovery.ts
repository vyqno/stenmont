import type { Hex } from "viem";
import type { Db } from "../app";
import type { ChainClient } from "../chain";
import { journalClient, settleJournal } from "./gasJournal";
/** Bounded fair receipt polling. Unknown, missing-hash and legacy unjournaled reservations are never refunded by inference. */
export async function runGasRecovery({db,chain,now}:{db:Db;chain:ChainClient;now:Date}){
 if(!chain.lookupReceipt)return;
 const client=journalClient(db);
 const rows=await client.prepare("SELECT id,tx_hash,actual_cost,receipt_status,gas_used FROM relayer_gas_holds WHERE (status='sent' AND tx_hash IS NOT NULL) OR (status='settled' AND receipt_status='reverted' AND payer IS NOT NULL AND payer_released=0) ORDER BY COALESCE(last_checked_at,reserved_at),id LIMIT 20").all<{id:string;tx_hash:Hex;actual_cost:string|null;receipt_status:string|null;gas_used:string|null}>();
 for(const row of rows.results){
  await client.prepare("UPDATE relayer_gas_holds SET last_checked_at=? WHERE id=?").bind(now.toISOString(),row.id).run();
  try{
   if(row.receipt_status==='reverted'&&row.actual_cost!==null){await settleJournal(db,row.id,BigInt(row.actual_cost),undefined,now);continue;}
   const receipt=await chain.lookupReceipt(row.tx_hash);
   if(!receipt)continue;
   await settleJournal(db,row.id,receipt.gasUsed*receipt.effectiveGasPrice,receipt,now);
  }catch{ /* A later cron retries. No send, signature or release occurs on uncertain RPC results. */ }
 }
}
