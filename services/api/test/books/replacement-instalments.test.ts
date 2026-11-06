import { describe, expect, it } from "vitest";
import { reconcile, type Input } from "../../src/books/reconcile";
const id=`0x${"ab".repeat(32)}`, tx=`0x${"12".repeat(32)}`;
const input: Input = { period:"2026-11", invoices:[{id,number:"INV-1",amount:100000000n,status:"cancelled",taxRateBps:null,taxLabel:null,dueDate:null,createdAt:"2026-10-01T00:00:00.000Z",createTxHash:null}], payments:[{id:"instalment:receipt",invoiceId:id,payer:"payer",value:33333334n,txHash:tx,at:"2026-10-31T23:59:00.000Z",recordedAt:"2026-11-06T12:00:00.000Z",rail:"replacement_subscription",agreementId:id}], refunds:[],claims:[],gas:[],closedPeriods:{"2026-10":"2026-11-01T01:00:00.000Z"} };
describe("replacement payment rail accounting",()=>{
  it("books actual cash as a labelled next-period adjustment without reopening the router invoice",()=>{
    const result=reconcile(input);
    expect(result.lines[0]).toMatchObject({kind:"instalment",amount:33333334n,txHash:tx,adjustmentFor:"2026-10",debit:"Cash (USDT)",credit:"Sales revenue"});
    expect(result.lines[0]!.description).toContain("original router invoice cancelled");
    expect(result.invoices[0]).toMatchObject({status:"cancelled",state:"partial",paidToDate:33333334n,open:66666666n});
    expect(result.flags.some(f=>f.code==="payment_on_inactive_invoice")).toBe(false);
    expect(result.leaves[0]).toMatchObject({kind:"instalment",txHash:tx});
  });
});
