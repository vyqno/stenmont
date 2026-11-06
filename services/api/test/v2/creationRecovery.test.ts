import {expect,it} from 'vitest';
import {eq} from 'drizzle-orm';
import {zeroAddress,type Hex} from 'viem';
import {runIndexer} from '../../src/indexer';
import {invoices,chainCursor} from '../../src/db/schema';
import {setup,seedMerchant,PAYOUT_ADDRESS} from '../helpers/app';
import {dbOf} from '../helpers/fixtures';
const router=`0x${'3'.repeat(40)}` as const,claim=`0x${'4'.repeat(40)}`,id=`0x${'a'.repeat(64)}` as Hex,tx=`0x${'b'.repeat(64)}` as Hex;
async function world(options:{journalled?:boolean;log?:boolean;wrongRouter?:boolean;receipt?:'success'|'reverted'|null;paid?:boolean;recent?:boolean;wrongAmount?:boolean}={}){
 const ranges:bigint[][]=[];
 const t=setup({getBlockNumber:async()=>1000n,getRouterLogs:async(from,to)=>{ranges.push([from,to]);return options.log===false?[]:[{eventName:'InvoiceCreated',args:{id},address:options.wrongRouter?zeroAddress:router,blockNumber:900n,transactionHash:tx,logIndex:0}];},invoiceDetails:async()=>({payout:PAYOUT_ADDRESS,payerLock:zeroAddress,minPayment:0n,hook:zeroAddress,discountBps:0,discountUntil:0n,amount:options.wrongAmount?2000000n:1000000n,dueDate:0n,paid:0n,status:1}),lookupReceipt:async()=>options.receipt===null?null:{status:options.receipt??'success',gasUsed:1n,effectiveGasPrice:1n}}, {ROUTER_V2_ADDRESS:router,ROUTER_V2_DEPLOY_BLOCK:'500',INVOICE_CLAIM_V2_ADDRESS:claim});
 await seedMerchant(t.db);const db=dbOf(t.db),stamp=options.recent?new Date().toISOString():'2000-01-01T00:00:00Z';
 await db.insert(invoices).values({id,merchantId:'m_1',number:'DISCONNECTED',contractVersion:'v2',routerAddress:router,claimAddress:claim,payout:PAYOUT_ADDRESS,status:options.paid?'paid':'creating',amount:'1000000',amountPaid:options.paid?'1000000':'0',createTxHash:options.paid?tx:null,metaHash:id,createdAt:stamp,updatedAt:stamp});
 if(options.journalled)await t.db.prepare('INSERT INTO protocol_events VALUES(?,?,?,?)').bind(1874,router,tx,0).run();
 if(!options.recent)await db.insert(chainCursor).values({name:`router:1874:${router}`,lastBlock:998});
 const row=async()=>(await db.select().from(invoices).where(eq(invoices.id,id)))[0]!;
 return {t,db,row,ranges,run:()=>runIndexer(t.env,db,t.chain,'v2')};
}
it('normal confirmed InvoiceCreated opens a creating row and records the exact transaction',async()=>{
 const w=await world({recent:true});expect((await w.run()).status).toBe('ok');expect(await w.row()).toMatchObject({status:'open',createTxHash:tx});
});
it('bounded recovery reconciles a journalled creation even while cursor is idle and never broadcasts',async()=>{
 const w=await world({journalled:true});await w.run();expect(await w.row()).toMatchObject({status:'open',createTxHash:tx});expect(w.ranges).toEqual([[500n,998n]]);expect(w.t.chain.sent).toHaveLength(0);
 await w.run();expect(w.ranges).toHaveLength(1);
});
it.each([{log:false},{wrongRouter:true},{receipt:null},{receipt:'reverted' as const},{wrongAmount:true}])('unproven creation stays unchanged: %j',async options=>{
 const w=await world(options),before=await w.row();await w.run();expect(await w.row()).toEqual(before);expect(w.t.chain.sent).toHaveLength(0);
});
it('paid invoice is never reopened or modified by creation recovery',async()=>{
 const w=await world({paid:true,journalled:true}),before=await w.row();await w.run();expect(await w.row()).toEqual(before);expect(w.ranges).toHaveLength(0);
});
