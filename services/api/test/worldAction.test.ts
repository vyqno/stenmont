import {expect,it} from 'vitest';
import {generatePrivateKey} from 'viem/accounts';
import {setup,seedMerchant} from './helpers/app';
import {dbOf} from './helpers/fixtures';
import {merchantTier} from '../src/verification/store';
import {assertDifferentHumans} from '../src/world/samehuman';
import {memoryWorldRepo} from './world/helpers';
const action='enrol-business-v2';
it('signs only the new merchant enrolment action and refuses the retired action before verification',async()=>{
 let calls=0;
 const t=setup({}, {WORLD_APP_ID:'app_fixture',WORLD_RP_ID:'rp_fixture',WORLD_RP_SIGNING_KEY:generatePrivateKey()},{fetch:(async()=>{calls++;return Response.json({success:true,environment:'staging',nullifier:'1'});}) as typeof fetch});
 const key=await seedMerchant(t.db);
 const post=(path:string,body:unknown)=>t.req(path,{key,method:'POST',body:JSON.stringify(body)});
 expect((await post('/v1/world/rp-signature',{action})).status).toBe(200);
 expect((await post('/v1/world/rp-signature',{action:'enrol-business'})).status).toBe(400);
 expect((await post('/v1/world/verify',{action:'enrol-business',idkitResponse:{environment:'staging'}})).status).toBe(400);
 expect(calls).toBe(0);
});
it('old enrolments neither mark the new status verified nor grant World tier; new enrolments do',async()=>{
 const t=setup();const key=await seedMerchant(t.db);const at=t.clock.now.toISOString();
 await t.db.prepare('INSERT INTO world_enrollments(id,merchant_id,action,nullifier,verified_at) VALUES(?,?,?,?,?)').bind('old','m_1','enrol-business','1',at).run();
 expect(await (await t.req('/v1/world/status',{key})).json()).toMatchObject({enrolled:false});
 expect((await merchantTier(dbOf(t.db),'m_1',t.clock.now)).tier).toBe(0);
 await t.db.prepare('INSERT INTO world_enrollments(id,merchant_id,action,nullifier,verified_at) VALUES(?,?,?,?,?)').bind('new','m_1',action,'2',at).run();
 expect(await (await t.req('/v1/world/status',{key})).json()).toMatchObject({enrolled:true});
 expect((await merchantTier(dbOf(t.db),'m_1',t.clock.now)).tier).toBe(3);
});
it('the default same-human comparison covers new-action buyer and supplier nullifiers only',async()=>{
 const repo=memoryWorldRepo();
 repo.rows.push({id:'a',merchantId:'buyer',action,nullifier:'1',verifiedAt:'t'},{id:'b',merchantId:'supplier',action,nullifier:'1',verifiedAt:'t'});
 expect(await assertDifferentHumans(repo,'buyer','supplier')).toEqual({ok:false,code:'same_human'});
 repo.rows.splice(0,repo.rows.length,{id:'a',merchantId:'buyer',action:'enrol-business',nullifier:'1',verifiedAt:'t'},{id:'b',merchantId:'supplier',action:'enrol-business',nullifier:'1',verifiedAt:'t'});
 expect(await assertDifferentHumans(repo,'buyer','supplier')).toEqual({ok:true});
});
