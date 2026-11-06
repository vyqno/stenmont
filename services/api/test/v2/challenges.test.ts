import {expect,it} from 'vitest';
import {setup,seedMerchant} from '../helpers/app';
import {fakeChain} from '../helpers/chain';
const router=`0x${'3'.repeat(40)}`,claim=`0x${'4'.repeat(40)}`;
it('fresh v2 creator challenge binds actual router nonce and rejects expired submission',async()=>{
 const v2=fakeChain({creatorDelegation:async()=>({allowed:false,nonce:7n})});
 const t=setup({forVersion:()=>v2},{ROUTER_V2_ADDRESS:router,INVOICE_CLAIM_V2_ADDRESS:claim});const key=await seedMerchant(t.db);
 const r=await t.req('/v1/router-delegation?contractVersion=v2',{key});expect(r.status).toBe(200);
 expect(await r.json()).toMatchObject({contractVersion:'v2',routerAddress:router,nonce:'7',typedData:{domain:{version:'2',verifyingContract:router},primaryType:'SetCreator'}});
 const expired=await t.req('/v1/router-delegation',{key,method:'POST',body:JSON.stringify({contractVersion:'v2',deadline:1,signature:'0x12'})});expect(expired.status).toBe(400);expect(v2.sent).toHaveLength(0);
});
