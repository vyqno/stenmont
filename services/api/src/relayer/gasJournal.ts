import type { Hex } from "viem";
import type { Db } from "../app";
import type { Receipt } from "../chain";
import { dayOf, loadTank, type CapError } from "./caps";
export const journalClient = (db: Db) => (db as Db & {$client:D1Database}).$client;
type Hold = {id:string;merchant_id:string;reserved:string;reserved_at:string;status:string;tx_hash:string|null;relayer_tx_id:string|null;payer:string|null;payer_value:string|null;receipt_status:string|null;payer_released:number};

/** The tank compare-and-swap and durable hold insertion commit together. changes() belongs to this atomic batch. */
export async function reserveJournal(db:Db,merchant:string,amount:bigint,now:Date):Promise<string|CapError> {
 const client=journalClient(db),id=crypto.randomUUID();
 for(let attempt=0;attempt<8;attempt++){
  const tank=await loadTank(db,merchant,now);
  if(!tank||tank.balance<amount)return "gas_tank_empty";
  if(tank.spentToday+amount>tank.dailyCap)return "gas_cap_reached";
  const result=await client.batch([
   client.prepare("UPDATE gas_tanks SET wbt_balance=?,spent_today_wbt=?,spent_day=?,version=version+1 WHERE merchant_id=? AND version=?").bind((tank.balance-amount).toString(),(tank.spentToday+amount).toString(),dayOf(now),merchant,tank.version),
   client.prepare("INSERT INTO relayer_gas_holds(id,merchant_id,reserved,reserved_at) SELECT ?,?,?,? WHERE changes()=1").bind(id,merchant,amount.toString(),now.toISOString()),
  ]);
  if(result[1]!.meta.changes===1)return id;
 }
 return "busy";
}
export async function markJournalSent(db:Db,id:string,hash:Hex,payment?:{id:string;payer:string;value:bigint}){
 const client=journalClient(db);
 const statements=[client.prepare("UPDATE relayer_gas_holds SET status='sent',tx_hash=?,relayer_tx_id=?,payer=?,payer_value=? WHERE id=? AND status='held'").bind(hash,payment?.id??null,payment?.payer.toLowerCase()??null,payment?.value.toString()??null,id)];
 if(payment)statements.push(client.prepare("UPDATE relayer_txs SET status='sent',tx_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM relayer_gas_holds WHERE id=? AND status='sent' AND tx_hash=?)").bind(hash,payment.id,id,hash));
 await client.batch(statements);
}
/** A receipt never broadcasts anything. Tank refund and durable settlement marker are one transaction. */
export async function settleJournal(db:Db,id:string,actual:bigint,receipt?:Receipt,observedAt=new Date()):Promise<void>{
 if(actual<0n)throw Error("Invalid gas cost");
 const client=journalClient(db);
 for(let attempt=0;attempt<1000;attempt++){
  const hold=await client.prepare("SELECT * FROM relayer_gas_holds WHERE id=?").bind(id).first<Hold>();
  if(!hold)throw Error("Gas hold is missing");
  if(hold.status==='settled'){await releaseJournalPayer(db,hold);return;}
  const original=new Date(hold.reserved_at),tank=await loadTank(db,hold.merchant_id,original);
  if(!tank)throw Error("Gas tank is missing");
  const refund=BigInt(hold.reserved)-actual;
  const spent=tank.day===dayOf(original)?(tank.stored>refund?tank.stored-refund:0n):tank.stored;
  const statements=[
   client.prepare("UPDATE gas_tanks SET wbt_balance=?,spent_today_wbt=?,version=version+1 WHERE merchant_id=? AND version=? AND EXISTS(SELECT 1 FROM relayer_gas_holds WHERE id=? AND status!='settled')").bind((tank.balance+refund).toString(),spent.toString(),hold.merchant_id,tank.version,id),
   client.prepare("UPDATE relayer_gas_holds SET status='settled',actual_cost=?,receipt_status=?,gas_used=? WHERE id=? AND changes()=1 AND status!='settled'").bind(actual.toString(),receipt?.status??null,receipt?.gasUsed.toString()??null,id),
  ];
  if(receipt&&hold.relayer_tx_id)statements.push(client.prepare("UPDATE relayer_txs SET status=?,gas_used=?,wbt_cost=?,updated_at=? WHERE id=? AND tx_hash=? AND EXISTS(SELECT 1 FROM relayer_gas_holds WHERE id=? AND status='settled' AND actual_cost=?)").bind(receipt.status==='success'?'success':'reverted',receipt.gasUsed.toString(),actual.toString(),observedAt.toISOString(),hold.relayer_tx_id,hold.tx_hash,id,actual.toString()));
  const result=await client.batch(statements);
  if(result[1]!.meta.changes!==1)continue;
  await releaseJournalPayer(db,{...hold,status:'settled',receipt_status:receipt?.status??null});
  return;
 }
 throw Error("Gas settlement contention did not clear");
}
async function releaseJournalPayer(db:Db,hold:Hold){
 if(hold.receipt_status!=='reverted'||!hold.payer||!hold.payer_value||hold.payer_released)return;
 const client=journalClient(db),day=dayOf(new Date(hold.reserved_at));
 for(let attempt=0;attempt<1000;attempt++){
  const current=await client.prepare("SELECT payer_released FROM relayer_gas_holds WHERE id=?").bind(hold.id).first<{payer_released:number}>();
  if(current?.payer_released)return;
  const usage=await client.prepare("SELECT usdt FROM payer_usage WHERE merchant_id=? AND payer=? AND day=?").bind(hold.merchant_id,hold.payer,day).first<{usdt:string}>();
  if(!usage)throw Error("Reserved payer usage is missing");
  const used=BigInt(usage.usdt),amount=BigInt(hold.payer_value);
  const result=await client.batch([
   client.prepare("UPDATE payer_usage SET usdt=? WHERE merchant_id=? AND payer=? AND day=? AND usdt=? AND EXISTS(SELECT 1 FROM relayer_gas_holds WHERE id=? AND payer_released=0 AND receipt_status='reverted')").bind((used>amount?used-amount:0n).toString(),hold.merchant_id,hold.payer,day,usage.usdt,hold.id),
   client.prepare("UPDATE relayer_gas_holds SET payer_released=1 WHERE id=? AND changes()=1 AND payer_released=0").bind(hold.id),
  ]);
  if(result[1]!.meta.changes===1)return;
 }
 throw Error("Payer release contention did not clear");
}
