import {expect,it} from 'vitest';
import {setup,seedMerchant,PAYOUT_ADDRESS} from '../helpers/app';
import {fakeChain} from '../helpers/chain';
const router=`0x${'3'.repeat(40)}`,claim=`0x${'4'.repeat(40)}`,buyer=`0x${'5'.repeat(40)}` as const;
it('ack challenge uses current nominated buyer and nonce, rejects wrong buyer and expires before gas',async()=>{
 const v2=fakeChain({creatorDelegation:async()=>({allowed:true,nonce:0n}),invoiceDetails:async()=>({payout:PAYOUT_ADDRESS,payerLock:buyer,minPayment:0n,hook:`0x${'0'.repeat(40)}`,amount:1000000n,paid:0n,status:1,dueDate:1794052800n,discountBps:0,discountUntil:0n}),acknowledgement:async()=>({nonce:8n,ackedAt:0n})});
 const t=setup({forVersion:()=>v2},{INVOICE_DEFAULT_VERSION:'2',ROUTER_V2_ADDRESS:router,INVOICE_CLAIM_V2_ADDRESS:claim,INVOICE_ACK_ADDRESS:`0x${'6'.repeat(40)}`});const key=await seedMerchant(t.db);
 const made=await t.req('/v1/invoices',{key,idem:'ack-fixture',method:'POST',body:JSON.stringify({amount:'1',buyerAddress:buyer,dueDate:'2026-11-07T12:00:00Z'})});expect(made.status).toBe(201);const {id}=await made.json() as any;
 const post=(path:string,body:unknown)=>t.req(`/pay/${id}/${path}`,{method:'POST',body:JSON.stringify(body)});
 const r=await post('ack-request',{buyer});expect(r.status).toBe(200);expect(await r.json()).toMatchObject({buyer,nonce:'8',typedData:{domain:{name:'Stenmont InvoiceAck',version:'1'},message:{invoiceId:id,amount:'1000000'}}});
 expect((await post('ack-request',{buyer:PAYOUT_ADDRESS})).status).toBe(422);
 expect((await post('ack',{buyer,deadline:1,signature:'0x12'})).status).toBe(400);expect(v2.sent).toHaveLength(0);
});
