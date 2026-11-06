export const LIMITS = { daily: 50000, monthly: 250000, conversation: 20000, rate: 10 } as const;
const charged = "CASE WHEN status='pending' THEN reserved ELSE actual END";
export async function reserve(db: D1Database, merchant: string, conversation: string, provider: string, tokens: number, now: Date): Promise<string|null> {
 if (!Number.isSafeInteger(tokens) || tokens < 1 || tokens > LIMITS.conversation) return null;
 const at=now.toISOString(), day=at.slice(0,10), month=at.slice(0,7), minute=at.slice(0,16), id=crypto.randomUUID();
 // One SQL statement checks and reserves all scopes: no read/write race, even across Worker isolates.
 const r=await db.prepare(`INSERT INTO agent_usage(id,merchant_id,conversation_id,provider,reserved,created_at)
 SELECT ?,?,?,?,?,? WHERE
 (SELECT COALESCE(SUM(${charged}),0) FROM agent_usage WHERE merchant_id=? AND substr(created_at,1,10)=?)+?<=? AND
 (SELECT COALESCE(SUM(${charged}),0) FROM agent_usage WHERE merchant_id=? AND substr(created_at,1,7)=?)+?<=? AND
 (SELECT COALESCE(SUM(${charged}),0) FROM agent_usage WHERE merchant_id=? AND conversation_id=?)+?<=? AND
 (SELECT COUNT(*) FROM agent_usage WHERE merchant_id=? AND substr(created_at,1,16)=?)<? AND
 NOT EXISTS(SELECT 1 FROM agent_usage WHERE merchant_id=? AND conversation_id=? AND status='pending')`)
 .bind(id,merchant,conversation,provider,tokens,at,merchant,day,tokens,LIMITS.daily,merchant,month,tokens,LIMITS.monthly,merchant,conversation,tokens,LIMITS.conversation,merchant,minute,LIMITS.rate,merchant,conversation).run();
 return r.meta.changes===1?id:null;
}
export async function settle(db:D1Database,id:string,actual:number) {
 if(!Number.isSafeInteger(actual)||actual<0)throw new Error("Invalid token usage");
 // Provider maxima and pessimistic input estimates bound actual below the reservation.
 const row=await db.prepare("SELECT reserved FROM agent_usage WHERE id=?").bind(id).first<{reserved:number}>();
 if(!row||actual>row.reserved)throw new Error("Usage exceeds reservation");
 await db.prepare("UPDATE agent_usage SET status='settled',actual=? WHERE id=? AND status='pending'").bind(actual,id).run();
}
export async function usage(db:D1Database,merchant:string,now:Date){
 const at=now.toISOString();
 const row=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN substr(created_at,1,10)=? THEN ${charged} ELSE 0 END),0) daily, COALESCE(SUM(${charged}),0) monthly FROM agent_usage WHERE merchant_id=? AND substr(created_at,1,7)=?`).bind(at.slice(0,10),merchant,at.slice(0,7)).first<{daily:number;monthly:number}>();
 return {...row!,limits:LIMITS,costLabel:"Estimated cost; provider billing is authoritative"};
}
