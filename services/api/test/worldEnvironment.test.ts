// Staging deployment can use the real World environment; all verifier/chain responses here are fixtures.
import {expect,it} from 'vitest';
import {generatePrivateKey} from 'viem/accounts';
import {setup,seedMerchant} from './helpers/app';
const account=`0x${'5'.repeat(40)}`;
const fixture=()=>{
 const calls:Record<string,unknown>[]=[];
 const t=setup({}, {ENVIRONMENT:'staging',WORLD_ENVIRONMENT:'production',WORLD_APP_ID:'app_fixture',WORLD_RP_ID:'rp_fixture',WORLD_RP_SIGNING_KEY:generatePrivateKey(),ATTESTER_PRIVATE_KEY:generatePrivateKey()},{fetch:(async (_url,init)=>{
  const proof=JSON.parse(String(init?.body));calls.push(proof);
  return Response.json({success:true,environment:'production',nullifier:'0xabc',action:proof.action});
 }) as typeof fetch});
 return {t,calls};
};
it('explicit production World override is returned for merchant and investor requests on staging',async()=>{
 const {t}=fixture();const key=await seedMerchant(t.db);
 const merchant=await t.req('/v1/world/rp-signature',{key,method:'POST',body:JSON.stringify({action:'enrol-business-v2'})});
 expect(merchant.status).toBe(200);expect(await merchant.json()).toMatchObject({app_id:'app_fixture',environment:'production'});
 const investor=await t.req('/invest/allow-request',{method:'POST',body:JSON.stringify({account})});
 expect(investor.status).toBe(200);expect(await investor.json()).toMatchObject({app_id:'app_fixture',environment:'production'});
});
it('explicit override accepts production enrolment fixture and rejects staging proof before verification',async()=>{
 const {t,calls}=fixture();const key=await seedMerchant(t.db);
 const wrong=await t.req('/v1/world/verify',{key,method:'POST',body:JSON.stringify({action:'enrol-business-v2',idkitResponse:{action:'enrol-business-v2',environment:'staging'}})});
 expect(wrong.status).toBe(422);expect(await wrong.json()).toMatchObject({error:{code:'wrong_environment'}});expect(calls).toHaveLength(0);
 const right=await t.req('/v1/world/verify',{key,method:'POST',body:JSON.stringify({action:'enrol-business-v2',idkitResponse:{action:'enrol-business-v2',environment:'production'}})});
 expect(right.status).toBe(200);expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({environment:'production'});
 expect(await t.db.prepare('SELECT proof_environment FROM world_enrollments').first()).toMatchObject({proof_environment:'production'});
});
it('investor override rejects staging proof before verifier or fake chain and accepts production fixture',async()=>{
 const {t,calls}=fixture();
 const wrong=await t.req('/invest/allow',{method:'POST',body:JSON.stringify({account,idkitResponse:{action:'allow-investor',environment:'staging'}})});
 expect(wrong.status).toBe(422);expect(await wrong.json()).toMatchObject({error:{code:'wrong_environment'}});expect(calls).toHaveLength(0);expect(t.chain.allowedSent).toHaveLength(0);
 const right=await t.req('/invest/allow',{method:'POST',body:JSON.stringify({account,idkitResponse:{action:'allow-investor',environment:'production'}})});
 expect(right.status).toBe(200);expect(calls).toHaveLength(1);expect(t.chain.allowedSent).toHaveLength(1);
});
