import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import type { Receipt } from "../src/chain";
import { runGasRecovery } from "../src/relayer/recovery";
import { holdGas, reserveGas } from "../src/relayer/caps";
import { sendFromTank } from "../src/relayer/tankSend";
import { setup, seedMerchant } from "./helpers/app";
import { seedInvoice } from "./helpers/fixtures";
const INITIAL = 10n ** 18n;
const ACTUAL = 150000n * 5000000000n;
const PAYER = `0x${"33".repeat(20)}` as const;
async function world(status: Receipt["status"] = "success") {
  const found = { receipt: null as Receipt | null };
  const t = setup({ waitForReceipt: async () => { throw new Error("receipt timeout"); }, lookupReceipt: async () => found.receipt });
  await seedMerchant(t.db);
  const invoice = await seedInvoice(t.db, "RECOVERY", 100000000n);
  await t.db.prepare("INSERT INTO gas_tanks(merchant_id,wbt_balance,daily_cap_wbt,spent_today_wbt,spent_day,per_payer_daily_cap_usdt,version) VALUES('m_1',?,?,'0','2026-11-06','1000000000',0)").bind(INITIAL.toString(), INITIAL.toString()).run();
  const pay = () => t.req("/relay/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId: invoice, value: "1", payer: PAYER, validAfter: "0", validBefore: "9999999999", salt: `0x${"44".repeat(32)}`, signature: `0x${"55".repeat(65)}` }) });
  const recover = () => runGasRecovery({ db: drizzle(t.db), chain: t.chain, now: new Date("2026-11-06T12:02:00Z") });
  const tank = () => t.db.prepare("SELECT * FROM gas_tanks WHERE merchant_id='m_1'").first<{wbt_balance:string;spent_today_wbt:string}>();
  return {t, found, pay, recover, tank, receipt: { status, gasUsed: 150000n, effectiveGasPrice: 5000000000n } satisfies Receipt};
}
describe("durable gas receipt recovery", () => {
  it("settles a later successful receipt once across concurrent cron runs without sending again", async () => {
    const w = await world(); expect((await w.pay()).status).toBe(504);
    w.found.receipt = w.receipt;
    await Promise.all([w.recover(), w.recover(), w.recover()]);
    expect((await w.tank())!.wbt_balance).toBe((INITIAL-ACTUAL).toString());
    expect((await w.tank())!.spent_today_wbt).toBe(ACTUAL.toString());
    expect(await w.t.db.prepare("SELECT status,wbt_cost FROM relayer_txs").first()).toMatchObject({status:"success",wbt_cost:ACTUAL.toString()});
    expect(w.t.chain.sent).toHaveLength(1);
    expect(await w.t.db.prepare("SELECT usdt FROM payer_usage").first()).toMatchObject({usdt:"1000000"});
    await w.recover(); expect((await w.tank())!.wbt_balance).toBe((INITIAL-ACTUAL).toString());
  });
  it("charges reverted receipt gas and releases the original payer allowance exactly once", async () => {
    const w = await world("reverted"); await w.pay(); w.found.receipt=w.receipt;
    await Promise.all([w.recover(),w.recover()]);
    expect((await w.tank())!.wbt_balance).toBe((INITIAL-ACTUAL).toString());
    expect(await w.t.db.prepare("SELECT usdt FROM payer_usage").first()).toMatchObject({usdt:"0"});
    expect(await w.t.db.prepare("SELECT status FROM relayer_txs").first()).toMatchObject({status:"reverted"});
    expect(w.t.chain.sent).toHaveLength(1);
  });
  it("keeps unknown receipts and lookup errors fully held", async () => {
    const w=await world(); await w.pay(); const before=await w.tank();
    await w.recover(); w.t.chain.lookupReceipt=async()=>{throw Error("RPC unavailable");}; await w.recover();
    expect(await w.tank()).toEqual(before);
    expect(await w.t.db.prepare("SELECT status FROM relayer_txs").first()).toMatchObject({status:"sent"});
    expect(w.t.chain.sent).toHaveLength(1);
  });
  it("recovers generic tank sends and preserves a later UTC day's spending counter",async()=>{
    const w=await world();
    expect(await sendFromTank({db:drizzle(w.t.db),chain:w.t.chain,now:w.t.clock.now},"m_1",{to:PAYER,data:"0x"})).toMatchObject({code:"timeout"});
    await w.t.db.prepare("UPDATE gas_tanks SET spent_day='2026-11-07',spent_today_wbt='123',version=version+1").run();
    w.found.receipt=w.receipt; await w.recover();
    expect(await w.tank()).toMatchObject({wbt_balance:(INITIAL-ACTUAL).toString(),spent_today_wbt:"123"});
    expect(w.t.chain.sent).toHaveLength(1);
  });
  it.each(["relayer_gas_holds", "relayer_txs"])("rolls back gas refund when the %s settlement write fails",async(table)=>{
    const w=await world(); await w.pay(); const before=await w.tank(); w.found.receipt=w.receipt;
    const predicate=table==='relayer_gas_holds'?"NEW.status='settled'":"NEW.status='success'";
    await w.t.db.prepare(`CREATE TRIGGER interrupted BEFORE UPDATE ON ${table} WHEN ${predicate} BEGIN SELECT RAISE(ABORT,'fixture outage'); END`).run();
    await w.recover(); expect(await w.tank()).toEqual(before);
    expect(await w.t.db.prepare("SELECT status FROM relayer_txs").first()).toMatchObject({status:'sent'});
    await w.t.db.prepare("DROP TRIGGER interrupted").run(); await w.recover();
    expect((await w.tank())!.wbt_balance).toBe((INITIAL-ACTUAL).toString());
    await w.recover(); expect((await w.tank())!.wbt_balance).toBe((INITIAL-ACTUAL).toString());
  });
  it("reserves no tank balance if durable hold insertion cannot commit",async()=>{
    const w=await world(); const before=await w.tank();
    await w.t.db.prepare("CREATE TRIGGER interrupted BEFORE INSERT ON relayer_gas_holds BEGIN SELECT RAISE(ABORT,'fixture outage'); END").run();
    await expect(holdGas(drizzle(w.t.db),'m_1',1000n,w.t.clock.now)).rejects.toThrow();
    expect(await w.tank()).toEqual(before);
    expect(w.t.chain.sent).toHaveLength(0);
  });
  it("keeps pre-migration sent rows held instead of inventing their missing reservation amount",async()=>{
    const w=await world(); const db=drizzle(w.t.db); await reserveGas(db,'m_1',1000n,w.t.clock.now);
    await w.t.db.prepare("INSERT INTO relayer_txs(id,merchant_id,kind,tx_hash,status,idempotency_key,created_at,updated_at) VALUES('legacy','m_1','pay',?,'sent','legacy','2026-11-06','2026-11-06')").bind(`0x${"66".repeat(32)}`).run();
    const before=await w.tank(); w.found.receipt=w.receipt; await w.recover();
    expect(await w.tank()).toEqual(before);
    expect(await w.t.db.prepare("SELECT status FROM relayer_txs WHERE id='legacy'").first()).toMatchObject({status:'sent'});
    expect(w.t.chain.sent).toHaveLength(0);
  });
  it("settles independent merchants' holds without moving credit between tanks",async()=>{
    const w=await world(); await seedMerchant(w.t.db,'m_2','Second business');
    await w.t.db.prepare("INSERT INTO gas_tanks(merchant_id,wbt_balance,daily_cap_wbt,spent_today_wbt,spent_day,per_payer_daily_cap_usdt,version) VALUES('m_2','5000','5000','0','2026-11-06','1000000',0)").run();
    const db=drizzle(w.t.db),first=await holdGas(db,'m_1',1000n,w.t.clock.now),second=await holdGas(db,'m_2',2000n,w.t.clock.now);
    if(typeof first==='string'||typeof second==='string')throw Error('fixture reservation failed');
    const one=`0x${"77".repeat(32)}` as const,two=`0x${"88".repeat(32)}` as const;
    await first.sent(one);await second.sent(two);
    w.t.chain.lookupReceipt=async(hash)=>({status:'success',gasUsed:hash===one?100n:200n,effectiveGasPrice:1n});
    await Promise.all([w.recover(),w.recover()]);
    expect((await w.tank())!.wbt_balance).toBe((INITIAL-100n).toString());
    expect(await w.t.db.prepare("SELECT wbt_balance,spent_today_wbt FROM gas_tanks WHERE merchant_id='m_2'").first()).toEqual({wbt_balance:'4800',spent_today_wbt:'200'});
  });

  it("retains an accepted payment with a lost RPC response and refuses a duplicate broadcast",async()=>{
    const w=await world(); w.t.chain.sendTransaction=async(call)=>{w.t.chain.sent.push(call);throw Error('response lost after acceptance');};
    expect((await w.pay()).status).toBe(504);
    const held=await w.tank(); expect(BigInt(held!.spent_today_wbt)).toBeGreaterThan(0n);
    expect((await w.pay()).status).toBe(409); await w.recover();
    expect(await w.tank()).toEqual(held); expect(w.t.chain.sent).toHaveLength(1);
    expect(await w.t.db.prepare("SELECT usdt FROM payer_usage").first()).toMatchObject({usdt:'1000000'});
  });
  it("keeps generic send gas held when the broadcast response is uncertain",async()=>{
    const w=await world(); w.t.chain.sendTransaction=async(call)=>{w.t.chain.sent.push(call);throw Error('response lost after acceptance');};
    expect(await sendFromTank({db:drizzle(w.t.db),chain:w.t.chain,now:w.t.clock.now},'m_1',{to:PAYER,data:'0x'})).toMatchObject({ok:false,code:'timeout'});
    expect(BigInt((await w.tank())!.spent_today_wbt)).toBeGreaterThan(0n);
    await w.recover(); expect(w.t.chain.sent).toHaveLength(1);
  });

});
