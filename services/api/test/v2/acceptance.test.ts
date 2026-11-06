import {expect,it} from 'vitest';
import {setup,seedMerchant} from '../helpers/app';
import {fakeChain} from '../helpers/chain';
const retained='m_6e8e647cb8f588bd';
it.each([['staging',retained,201],['staging','another-business',503],['production',retained,503]])('creation freeze exception is staging-only and exact-business scoped: %s %s',async(environment,configured,status)=>{
 const v2=fakeChain({creatorDelegation:async()=>({allowed:true,nonce:0n})});
 const t=setup({forVersion:()=>v2},{ENVIRONMENT:environment,INVOICE_CREATION_PAUSED:'yes',INVOICE_ACCEPTANCE_MERCHANT_ID:configured,INVOICE_DEFAULT_VERSION:'2',ROUTER_V2_ADDRESS:`0x${'3'.repeat(40)}`,INVOICE_CLAIM_V2_ADDRESS:`0x${'4'.repeat(40)}`});
 const key=await seedMerchant(t.db,retained);const r=await t.req('/v1/invoices',{key,idem:'acceptance',method:'POST',body:JSON.stringify({amount:'1'})});expect(r.status).toBe(status);expect(v2.calls).toHaveLength(status===201?1:0);
});
it('acceptance exception never reopens old-router creation while default remains v1',async()=>{
 const t=setup({},{ENVIRONMENT:'staging',INVOICE_CREATION_PAUSED:'yes',INVOICE_ACCEPTANCE_MERCHANT_ID:retained});const key=await seedMerchant(t.db,retained);
 expect((await t.req('/v1/invoices',{key,idem:'old-refused',method:'POST',body:JSON.stringify({amount:'1'})})).status).toBe(503);expect(t.chain.calls).toHaveLength(0);
});
