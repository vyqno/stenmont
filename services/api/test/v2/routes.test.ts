import {expect,it} from 'vitest';
import {setup,seedMerchant,PAYOUT_ADDRESS} from '../helpers/app';
import {fakeChain} from '../helpers/chain';
const router=`0x${'3'.repeat(40)}`,claim=`0x${'4'.repeat(40)}`,buyer=`0x${'5'.repeat(40)}`;
const env={INVOICE_DEFAULT_VERSION:'2',ROUTER_V2_ADDRESS:router,INVOICE_CLAIM_V2_ADDRESS:claim};
async function world(allowed=true){
 const v2=fakeChain({creatorDelegation:async()=>({allowed,nonce:0n})});
 const t=setup({forVersion:()=>v2},env);const key=await seedMerchant(t.db);
 const post=(body:unknown)=>t.req('/v1/invoices',{key,idem:crypto.randomUUID(),method:'POST',body:JSON.stringify(body)});
 return {t,v2,post};
}
it('v2 creation pins provenance and locks a named discounted buyer',async()=>{
 const w=await world();const r=await w.post({amount:'1',number:'V2',buyerAddress:buyer,discountBps:200,discountUntil:'2026-11-06T13:00:00Z',dueDate:'2026-11-07T12:00:00Z'});
 expect(r.status).toBe(201);expect(await r.json()).toMatchObject({contractVersion:'v2',routerAddress:router,claimAddress:claim,payout:PAYOUT_ADDRESS,payerLock:buyer,discountBps:200});
 expect(w.v2.calls[0]).toMatchObject({payerLock:buyer,discountBps:200,discountUntil:1793970000n});expect(w.t.chain.calls).toHaveLength(0);
});
it('discount without named buyer and arbitrary payerLock are refused before sending',async()=>{
 const w=await world();expect((await w.post({amount:'1',discountBps:200,discountUntil:'2026-11-06T13:00:00Z'})).status).toBe(400);
 expect((await w.post({amount:'1',payerLock:buyer})).status).toBe(400);expect(w.v2.calls).toHaveLength(0);
});
it('existing merchant requires actual fresh creator delegation without v1 fallback',async()=>{
 const w=await world(false);const r=await w.post({amount:'1'});expect(r.status).toBe(409);expect(await r.text()).toContain('creator_delegation_required');expect(w.v2.calls).toHaveLength(0);expect(w.t.chain.calls).toHaveLength(0);
});
it('creation kill flag never invokes either adapter',async()=>{
 const w=await world();w.t.env.INVOICE_CREATION_PAUSED='yes';expect((await w.post({amount:'1'})).status).toBe(503);expect(w.v2.calls).toHaveLength(0);
});

it('discount without due date is refused before insertion or gas',async()=>{const w=await world();expect((await w.post({amount:'1',buyerAddress:buyer,discountBps:200,discountUntil:'2026-11-06T13:00:00Z'})).status).toBe(400);expect(w.v2.calls).toHaveLength(0);});
