import {expect,it} from 'vitest';
import {setup,seedMerchant,PAYOUT_ADDRESS} from '../helpers/app';
import {fakeChain} from '../helpers/chain';
const zero=`0x${'0'.repeat(40)}` as const,buyer=`0x${'5'.repeat(40)}` as const;
it.each([
 {amount:2000000n,paid:1000000n,status:1,statusText:'partially_paid',remaining:'1',settlement:'1',discount:false},
 {amount:1000000n,paid:980000n,status:2,statusText:'paid',remaining:'0',settlement:'0',discount:false},
 {amount:1000000n,paid:0n,status:1,statusText:'open',remaining:'1',settlement:'0.98',discount:true},
])('public v2 view uses current chain facts over stale indexed state: $statusText $paid',async item=>{
 const chain=fakeChain({creatorDelegation:async()=>({allowed:true,nonce:0n}),invoiceDetails:async()=>({payout:PAYOUT_ADDRESS,payerLock:buyer,minPayment:0n,hook:zero,amount:item.amount,paid:item.paid,status:item.status,dueDate:1794052800n,discountBps:200,discountUntil:1793970000n})});
 const t=setup({forVersion:()=>chain},{INVOICE_DEFAULT_VERSION:'2',ROUTER_V2_ADDRESS:`0x${'3'.repeat(40)}`,INVOICE_CLAIM_V2_ADDRESS:`0x${'4'.repeat(40)}`}),key=await seedMerchant(t.db);
 const made=await t.req('/v1/invoices',{key,idem:'state',method:'POST',body:JSON.stringify({amount:'1'})});const {id}=await made.json() as any;
 const r=await t.req(`/pay/${id}`);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({amountPaid:item.paid===980000n?'0.98':item.paid===0n?'0':'1',status:item.statusText,remaining:item.remaining,settlementAmount:item.settlement,discountAvailable:item.discount,dueDate:'2026-11-07T12:00:00.000Z'});
});
