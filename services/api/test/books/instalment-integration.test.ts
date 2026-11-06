import {expect,it} from "vitest";
import {generatePrivateKey} from "viem/accounts";
import {seedMerchant,setup} from "../helpers/app";
import {seedInvoice} from "../helpers/fixtures";
const tx=(n:string)=>`0x${n.repeat(64)}`;
async function charge(t:ReturnType<typeof setup>,invoiceId:string,id:string,merchantId="m_1",hash=tx("1"),gas:string|null="30"){
 await t.db.prepare("INSERT INTO instalment_charges(id,merchant_id,invoice_id,subscription_id,agreement_id,payer,amount,tx_hash,observed_at,gas_cost_wbt) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,merchantId,invoiceId,"plan",id,"payer","1000000",hash,"2026-10-05T01:02:03.000Z",gas).run();
}
it("uses actual replacement cash, scopes merchants, and counts measured gas once per transaction",async()=>{
 const t=setup();const key=await seedMerchant(t.db);const invoice=await seedInvoice(t.db);
 await t.db.prepare("UPDATE invoices SET status='cancelled',created_at=? WHERE id=?").bind("2026-10-01T00:00:00.000Z",invoice).run();
 await charge(t,invoice,"a");await charge(t,invoice,"b");
 await charge(t,invoice,"other","m_other",tx("2"));
 const data=await (await t.req("/v1/books/2026-10",{key})).json() as any;
 expect(data.snapshot.lines.filter((l:any)=>l.kind==="instalment")).toHaveLength(2);
 expect(data.snapshot.lines.filter((l:any)=>l.kind==="gas")).toHaveLength(1);
 expect(data.snapshot.lines.find((l:any)=>l.kind==="gas").amount).toBe("30");
 expect(data.snapshot.lines.every((l:any)=>l.txHash===tx("1")&&l.date==="2026-10-05T01:02:03.000Z")).toBe(true);
 expect(data.snapshot.invoices[0]).toMatchObject({status:"cancelled",paidToDate:"2000000",open:"8000000"});
 expect(data.snapshot.lines[0].description).toContain("date observed");
 expect(JSON.stringify(data.snapshot.lines)).not.toContain("blockNumber");
 expect((await t.db.prepare("SELECT amount_paid,status FROM invoices WHERE id=?").bind(invoice).first())).toMatchObject({amount_paid:"0",status:"cancelled"});
});
it("keeps locked months unchanged and moves a late replacement receipt to the next open month",async()=>{
 const t=setup({}, {BOOKS_SIGNING_KEY:generatePrivateKey()});const key=await seedMerchant(t.db);const invoice=await seedInvoice(t.db);
 await t.db.prepare("UPDATE invoices SET status='cancelled',created_at=? WHERE id=?").bind("2026-10-01T00:00:00.000Z",invoice).run();
 expect((await t.req("/v1/books/2026-10/close",{key,method:"POST"})).status).toBe(201);
 t.clock.now=new Date("2026-11-06T12:01:00Z");await charge(t,invoice,"late");
 const data=await (await t.req("/v1/books/2026-11",{key})).json() as any;
 expect(data.snapshot.lines.map((l:any)=>l.kind)).toEqual(["instalment","gas"]);
 expect(data.snapshot.lines.every((l:any)=>l.adjustmentFor==="2026-10")).toBe(true);
 expect((await (await t.req("/v1/books/2026-10/bundle",{key})).json() as any).snapshot.lines).toHaveLength(0);
});
it("deduplicates charge gas against measured relayer costs and never invents missing gas",async()=>{
 const t=setup();const key=await seedMerchant(t.db);const invoice=await seedInvoice(t.db);
 await t.db.prepare("UPDATE invoices SET status='cancelled',created_at=? WHERE id=?").bind("2026-10-01T00:00:00.000Z",invoice).run();
 await charge(t,invoice,"known");await charge(t,invoice,"unknown","m_1",tx("3"),null);
 await t.db.prepare("INSERT INTO relayer_txs(id,merchant_id,kind,status,idempotency_key,created_at,updated_at,tx_hash,wbt_cost) VALUES(?,?,?,?,?,?,?,?,?)").bind("gas","m_1","instalment","success","gas","2026-10-05T01:02:03.000Z","2026-10-05T01:02:03.000Z",tx("1"),"50").run();
 const data=await (await t.req("/v1/books/2026-10",{key})).json() as any;
 expect(data.snapshot.lines.filter((l:any)=>l.kind==="instalment")).toHaveLength(2);
 expect(data.snapshot.lines.filter((l:any)=>l.kind==="gas")).toHaveLength(1);
 expect(data.snapshot.lines.find((l:any)=>l.kind==="gas")).toMatchObject({amount:"50",txHash:tx("1")});
});
it("does not book charge gas twice when its matching relayer row arrives in a later month",async()=>{
 const t=setup({}, {BOOKS_SIGNING_KEY:generatePrivateKey()});const key=await seedMerchant(t.db);const invoice=await seedInvoice(t.db);
 await t.db.prepare("UPDATE invoices SET status='cancelled',created_at=? WHERE id=?").bind("2026-10-01T00:00:00.000Z",invoice).run();
 await charge(t,invoice,"early");
 expect((await t.req("/v1/books/2026-10/close",{key,method:"POST"})).status).toBe(201);
 t.clock.now=new Date("2026-11-06T12:01:00Z");
 await t.db.prepare("INSERT INTO relayer_txs(id,merchant_id,kind,status,idempotency_key,created_at,updated_at,tx_hash,wbt_cost) VALUES(?,?,?,?,?,?,?,?,?)").bind("later","m_1","instalment","success","later","2026-11-06T12:00:00.000Z","2026-11-06T12:00:00.000Z",tx("1"),"30").run();
 const data=await (await t.req("/v1/books/2026-11",{key})).json() as any;
 expect(data.snapshot.lines).toHaveLength(0);
});
