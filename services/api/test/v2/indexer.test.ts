import {expect,it} from 'vitest';
import {runIndexer} from '../../src/indexer';
import {setup,seedMerchant} from '../helpers/app';
import {seedInvoice,dbOf} from '../helpers/fixtures';
import {fakeChain} from '../helpers/chain';
import {invoices} from '../../src/db/schema';
import {eq} from 'drizzle-orm';
const router=`0x${'3'.repeat(40)}`,claim=`0x${'4'.repeat(40)}`,buyer=`0x${'5'.repeat(40)}` as const,payout=`0x${'6'.repeat(40)}` as const;
it('v2 starts its own cursor, reads storage despite discount event preceding creation and never applies v1 logs',async()=>{
 const t=setup({}, {ROUTER_V2_ADDRESS:router,INVOICE_CLAIM_V2_ADDRESS:claim,ROUTER_V2_DEPLOY_BLOCK:'500'});await seedMerchant(t.db);const id=await seedInvoice(t.db) as `0x${string}`;
 const db=dbOf(t.db);const [row]=await db.select().from(invoices);await db.delete(invoices).where(eq(invoices.id,id));await db.insert(invoices).values({...row!,contractVersion:'v2',routerAddress:router,claimAddress:claim});
 const ranges:bigint[][]=[];let reads=0;
 const chain=fakeChain({getRouterLogs:async(a,b)=>{ranges.push([a,b]);return [{eventName:'DiscountTermsSet',args:{id},transactionHash:id,logIndex:0,blockNumber:500n},{eventName:'InvoiceCreated',args:{id},transactionHash:id,logIndex:1,blockNumber:500n}];},invoiceDetails:async()=>{reads++;return {payout,payerLock:buyer,minPayment:2n,hook:`0x${'0'.repeat(40)}`,discountBps:200,discountUntil:600n,amount:10000000n,dueDate:700n,paid:0n,status:1};}});
 expect((await runIndexer(t.env,db,chain,'v2')).status).toBe('ok');expect(ranges).toEqual([[500n,998n]]);expect(reads).toBe(2);
 expect((await db.select().from(invoices))[0]).toMatchObject({payerLock:buyer,minPayment:'2',discountBps:200,payout});
 expect((await t.db.prepare('SELECT count(*) n FROM protocol_events').first() as any).n).toBe(2);
 await runIndexer(t.env,db,chain);expect(reads).toBe(2);
 expect((await t.db.prepare('SELECT count(*) n FROM chain_cursor').first() as any).n).toBe(2);
});
