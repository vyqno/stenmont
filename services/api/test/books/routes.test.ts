import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { verifyMonthBundle } from "@stenmont/shared";
import { seedMerchant, setup } from "../helpers/app";
import { seedInvoice } from "../helpers/fixtures";

describe("books close API", () => {
  it("locks once, verifies signatures and scopes reads by merchant", async () => {
    const t = setup({}, {BOOKS_SIGNING_KEY:generatePrivateKey()});
    const key = await seedMerchant(t.db);
    const id = await seedInvoice(t.db);
    await t.db.prepare("UPDATE invoices SET created_at=? WHERE id=?").bind("2026-10-01T00:00:00.000Z",id).run();
    await t.db.prepare("INSERT INTO payments(id,invoice_id,payer,value,tx_hash,log_index,block_number,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("p1",id,"payer","10000000",`0x${"12".repeat(32)}`,0,1,"2026-10-02T00:00:00.000Z").run();
    const res = await t.req("/v1/books/2026-10/close", {key,method:"POST"});
    expect(res.status).toBe(201);
    const b = await res.json() as any;
    expect(await verifyMonthBundle(b.bundle,b.bundle.signer)).toBe(true);
    expect(b.anchor.status).toBe("not_anchored");
    expect((await t.req("/v1/books/2026-10/close",{key,method:"POST"})).status).toBe(409);
    expect((await t.req("/v1/books/2026-10/proof/1",{key})).status).toBe(200);
    const other = await seedMerchant(t.db,"m_2","Other",`sk_test_${"b".repeat(32)}`);
    expect((await t.req("/v1/books/2026-10/bundle",{key:other})).status).toBe(404);
    expect((await t.req("/v1/books/2026-10/proof/1",{key:other})).status).toBe(404);
  });
  it("refuses signing without configuration and invalid or unended months", async () => {
    const t=setup(); const key=await seedMerchant(t.db);
    expect((await t.req("/v1/books/2026-10/close",{key,method:"POST"})).status).toBe(503);
    expect((await t.req("/v1/books/2026-99",{key})).status).toBe(400);
    t.env.BOOKS_SIGNING_KEY=generatePrivateKey();
    expect((await t.req("/v1/books/2026-11/close",{key,method:"POST"})).status).toBe(400);
  });
});

describe("late sources and immutable exports",()=>{
  it("keeps the closed snapshot unchanged and books a backdated payment next month",async()=>{
    const t=setup({}, {BOOKS_SIGNING_KEY:generatePrivateKey()});const key=await seedMerchant(t.db);
    const id=await seedInvoice(t.db);
    await t.db.prepare("UPDATE invoices SET created_at=? WHERE id=?").bind("2026-10-01T00:00:00.000Z",id).run();
    expect((await t.req("/v1/books/2026-10/close",{key,method:"POST"})).status).toBe(201);
    await t.db.prepare("INSERT INTO payments(id,invoice_id,payer,value,tx_hash,log_index,block_number,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("late",id,"payer","4000000",`0x${"34".repeat(32)}`,0,2,"2026-10-05T00:00:00.000Z").run();
    const next=await (await t.req("/v1/books/2026-11",{key})).json() as any;
    expect(next.snapshot.lines[0]).toMatchObject({adjustmentFor:"2026-10",amount:"4000000"});
    const closed=await (await t.req("/v1/books/2026-10/bundle",{key})).json() as any;
    expect(closed.snapshot.lines).toHaveLength(0);
    const csv=await (await t.req("/v1/books/2026-10/export/ledger",{key})).text();
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });
  it("allows only one concurrent close",async()=>{
    const t=setup({}, {BOOKS_SIGNING_KEY:generatePrivateKey()});const key=await seedMerchant(t.db);
    const statuses=await Promise.all([1,2].map(async()=> (await t.req("/v1/books/2026-10/close",{key,method:"POST"})).status));
    expect(statuses.sort()).toEqual([201,409]);
  });
});

it("closes an explicitly requested staging interim snapshot, includes actual records, and defers later arrivals",async()=>{
 const t=setup({}, {ENVIRONMENT:"staging",BOOKS_SIGNING_KEY:generatePrivateKey()});const key=await seedMerchant(t.db);
 const id=await seedInvoice(t.db);
 await t.db.prepare("UPDATE invoices SET created_at=? WHERE id=?").bind("2026-11-01T00:00:00.000Z",id).run();
 const insert=(pid:string,tx:string)=>t.db.prepare("INSERT INTO payments(id,invoice_id,payer,value,tx_hash,log_index,block_number,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(pid,id,"payer","1000000",`0x${tx.repeat(32)}`,0,1,"2026-11-05T00:00:00.000Z").run();
 await insert("before","12");
 const response=await t.req("/v1/books/2026-11/close",{key,method:"POST",body:JSON.stringify({interimStaging:true})});
 expect(response.status).toBe(201);
 const data=await response.json() as any;
 expect(data.bundle.closeKind).toBe("interim_staging");
 expect(data.bundle.snapshot.lines).toHaveLength(1);
 await insert("after","34");
 t.clock.now=new Date("2026-11-06T12:01:00Z");
 const next=await (await t.req("/v1/books/2026-12",{key})).json() as any;
 expect(next.snapshot.lines).toHaveLength(1);
 expect(next.snapshot.lines[0]).toMatchObject({adjustmentFor:"2026-11",txHash:`0x${"34".repeat(32)}`});
});
it("refuses interim production snapshots and future staging snapshots",async()=>{
 const t=setup({}, {ENVIRONMENT:"production",BOOKS_SIGNING_KEY:generatePrivateKey()});const key=await seedMerchant(t.db);
 const body=JSON.stringify({interimStaging:true});
 expect((await t.req("/v1/books/2026-11/close",{key,method:"POST",body})).status).toBe(400);
 t.env.ENVIRONMENT="staging";
 expect((await t.req("/v1/books/2026-12/close",{key,method:"POST",body})).status).toBe(400);
});
