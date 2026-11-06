import {expect,it} from 'vitest';
import {decodeFunctionData,hashTypedData,type Hex} from 'viem';
import {b64urlEncode,buildReceiveAuth,refundNonce} from '@stenmont/shared';
import {paymentRouterV2Abi} from '../../../../packages/shared/src/abis/v2/paymentRouterV2';
import {setup,seedMerchant,PAYOUT_ADDRESS,MERCHANT_ADDRESS} from '../helpers/app';
import {fakeChain} from '../helpers/chain';
import {dbOf} from '../helpers/fixtures';
import {claims,gasTanks,payments} from '../../src/db/schema';
const router=`0x${'3'.repeat(40)}`,claim=`0x${'4'.repeat(40)}`,buyer=`0x${'5'.repeat(40)}` as const,salt=`0x${'7'.repeat(64)}` as const;
async function world(){
 const v2=fakeChain({creatorDelegation:async()=>({allowed:true,nonce:0n}),invoiceDetails:async()=>({payout:PAYOUT_ADDRESS,payerLock:buyer,minPayment:0n,hook:`0x${'0'.repeat(40)}`,amount:1000000n,paid:0n,status:1,dueDate:1794052800n,discountBps:200,discountUntil:1793970000n})});
 const t=setup({forVersion:()=>v2},{INVOICE_DEFAULT_VERSION:'2',ROUTER_V2_ADDRESS:router,INVOICE_CLAIM_V2_ADDRESS:claim});const key=await seedMerchant(t.db),db=dbOf(t.db);
 await db.insert(gasTanks).values({merchantId:'m_1',wbtBalance:'100000000000000000',dailyCapWbt:'100000000000000000',spentDay:'2026-11-06',perPayerDailyCapUsdt:'1000000000'});
 const create=async(body:unknown)=>{const r=await t.req('/v1/invoices',{key,idem:crypto.randomUUID(),method:'POST',body:JSON.stringify(body)});expect(r.status).toBe(201);return await r.json() as any;};
 const inv=await create({amount:'1',number:'V2-MONEY',buyerAddress:buyer,discountBps:200,discountUntil:'2026-11-06T13:00:00Z',dueDate:'2026-11-07T12:00:00Z'});
 const pay=(over:Record<string,unknown>={})=>t.req('/relay/pay',{method:'POST',body:JSON.stringify({invoiceId:inv.id,value:'0.98',payer:buyer,expectedPayout:PAYOUT_ADDRESS,validAfter:'0',validBefore:'1793970001',salt,signature:'0x12',...over})});
 return {t,v2,key,db,inv,create,pay};
}
it('v2 rejects wrong payer, payout and loose discount expiry before reserving or sending, then sends actual v2 calldata',async()=>{
 const w=await world();expect((await w.pay({payer:PAYOUT_ADDRESS})).status).toBe(422);expect((await w.pay({expectedPayout:buyer})).status).toBe(422);expect((await w.pay({validBefore:'1793970002'})).status).toBe(422);expect(w.v2.sent).toHaveLength(0);
 expect((await w.pay()).status).toBe(200);expect(w.v2.sent).toHaveLength(1);expect(w.t.chain.sent).toHaveLength(0);
 const call=w.v2.sent[0]!;expect(call.to).toBe(router);expect(decodeFunctionData({abi:paymentRouterV2Abi,data:call.data}).args?.slice(0,3)).toEqual([w.inv.id,980000n,PAYOUT_ADDRESS]);
});
it('v1 invoice remains payable on v1 after new-creation flag changes to v2',async()=>{
 const w=await world();w.t.env.INVOICE_DEFAULT_VERSION='1';const old=await w.create({amount:'1',number:'OLD-MONEY'});w.t.env.INVOICE_DEFAULT_VERSION='2';
 expect((await w.pay({invoiceId:old.id,value:'1'})).status).toBe(200);expect(w.t.chain.sent).toHaveLength(1);expect(w.t.chain.sent[0]!.to).toBe(w.t.env.ROUTER_ADDRESS);expect(w.v2.sent).toHaveLength(0);
});
it('refund authorization targets saved v2 router and funding challenge targets saved v2 claim',async()=>{
 const w=await world();await w.db.insert(payments).values({id:'p-v2',invoiceId:w.inv.id,payer:buyer,value:'980000',txHash:salt,logIndex:0,blockNumber:1,createdAt:w.t.clock.now.toISOString()});
 const refund=await w.t.req('/v1/refunds',{key:w.key,method:'POST',body:JSON.stringify({invoiceId:w.inv.id})});expect(refund.status).toBe(201);const r=await refund.json() as any;
 const digest=hashTypedData(buildReceiveAuth({from:MERCHANT_ADDRESS,to:router as Hex,value:980000n,validAfter:0n,validBefore:BigInt(r.authorization.validBefore),nonce:refundNonce(w.inv.id,buyer,r.authorization.salt)}));
 expect(r.challenge).toBe(b64urlEncode(Uint8Array.from(Buffer.from(digest.slice(2),'hex'))));
 const finance=await w.create({amount:'1',number:'V2-FINANCE',buyerAddress:buyer});
 await w.db.insert(claims).values({id:'cl-v2',invoiceId:finance.id,merchantId:'m_1',status:'listed',discountBps:500,reserveBps:1000,face:'1000000',price:'950000',reserve:'100000',dueDate:1794052800,deadline:1794050000,termsChallenge:'fixture',hookChallenge:'fixture',expiresAt:1794050000,createdAt:w.t.clock.now.toISOString(),updatedAt:w.t.clock.now.toISOString()});
 w.v2.allowed.add(buyer);
 const request=await w.t.req(`/invest/claims/${finance.id}/fund-request`,{method:'POST',body:JSON.stringify({account:buyer})});expect(request.status).toBe(200);expect(await request.json()).toMatchObject({to:claim,contractVersion:'v2',claimAddress:claim});
});
