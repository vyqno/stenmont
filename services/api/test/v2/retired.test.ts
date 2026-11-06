import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {decodeFunctionData,hashTypedData,type Hex} from 'viem';
import {paymentRouterAbi,b64urlEncode,buildReceiveAuth,refundNonce} from '@stenmont/shared';
import {invoiceProtocol,versionChain} from '../../src/protocol';
import {setup,seedMerchant,MERCHANT_ADDRESS} from '../helpers/app';
import {fakeChain} from '../helpers/chain';
import {dbOf} from '../helpers/fixtures';
import {invoices,gasTanks,payments} from '../../src/db/schema';
const RETIRED_ROUTER='0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929' as const;
const current='0x4c32942616d2BBeDD34bA1178bBF5823FDbbdDC0',id=`0x${'9'.repeat(64)}` as Hex,payer=`0x${'5'.repeat(40)}` as const,salt=`0x${'8'.repeat(64)}` as Hex;
it('receipt-classified migration preserves retired/current provenance and leaves failed no-receipt unassigned',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE invoices(id TEXT PRIMARY KEY,status TEXT,create_tx_hash TEXT)');
 const retired='0xfb846c0c72f854b543120e0b90549cc462acb5f3f621644ae2935ecd61e19256',fresh='0x2fd6429ed18f8149ac6b910b6563c8328976919372ef0632cde1d20ea53d4f1e',failed='0x6afa7aa8e936d566eaf85d8f41b131e22f27975e4aedecff4a114a887a0dcf1f';
 for(const [key,status] of [[retired,'paid'],[fresh,'open'],[failed,'failed']])db.prepare('INSERT INTO invoices(id,status) VALUES(?,?)').run(key!,status!);
 db.exec(readFileSync(new URL('../../migrations/0071_invoice_protocol.sql',import.meta.url),'utf8'));
 expect(db.prepare('SELECT router_address,claim_address,status FROM invoices WHERE id=?').get(retired)).toMatchObject({router_address:RETIRED_ROUTER.toLowerCase(),claim_address:null,status:'paid'});
 expect(db.prepare('SELECT router_address,claim_address FROM invoices WHERE id=?').get(fresh)).toMatchObject({router_address:current.toLowerCase(),claim_address:expect.any(String)});
 expect(db.prepare('SELECT router_address FROM invoices WHERE id=?').get(failed)).toMatchObject({router_address:null});
 expect(()=>db.prepare('UPDATE invoices SET router_address=? WHERE id=?').run(current,retired)).toThrow('immutable invoice provenance');
});
it('unsupported router never silently selects current contracts',()=>{
 const t=setup({},{ROUTER_ADDRESS:current});expect(()=>invoiceProtocol(t.env,{contractVersion:'v1',routerAddress:`0x${'6'.repeat(40)}`})).toThrow();
 expect(()=>versionChain(t.chain,'v1',RETIRED_ROUTER,current)).toThrow('Retired router adapter unavailable');
});
it('retired open/partial invoice pays original router, refund challenge targets original router, no claim is invented',async()=>{
 const retired=fakeChain(),t=setup({forRouter:router=>{expect(router).toBe(RETIRED_ROUTER);return retired;}},{ROUTER_ADDRESS:current});const key=await seedMerchant(t.db),db=dbOf(t.db),stamp=t.clock.now.toISOString();
 await db.insert(invoices).values({id,merchantId:'m_1',number:'HISTORIC',contractVersion:'v1',routerAddress:RETIRED_ROUTER,claimAddress:null,status:'partially_paid',amount:'3000000',amountPaid:'1000000',metaHash:id,createdAt:stamp,updatedAt:stamp});
 await db.insert(gasTanks).values({merchantId:'m_1',wbtBalance:'100000000000000000',dailyCapWbt:'100000000000000000',spentDay:'2026-11-06',perPayerDailyCapUsdt:'1000000000'});
 const view=await t.req(`/pay/${id}`);expect(await view.json()).toMatchObject({routerAddress:RETIRED_ROUTER,claimAddress:null,remaining:'2'});
 const res=await t.req('/relay/pay',{method:'POST',body:JSON.stringify({invoiceId:id,value:'2',payer,validAfter:'0',validBefore:'9999999999',salt,signature:'0x12'})});expect(res.status).toBe(200);
 expect(retired.sent[0]!.to).toBe(RETIRED_ROUTER);expect(decodeFunctionData({abi:paymentRouterAbi,data:retired.sent[0]!.data}).functionName).toBe('pay');expect(t.chain.sent).toHaveLength(0);
 await db.insert(payments).values({id:'oldpayment',invoiceId:id,payer,value:'1000000',txHash:salt,logIndex:0,blockNumber:1,createdAt:stamp});
 const refund=await t.req('/v1/refunds',{key,method:'POST',body:JSON.stringify({invoiceId:id})});expect(refund.status).toBe(201);const r=await refund.json() as any;
 const digest=hashTypedData(buildReceiveAuth({from:MERCHANT_ADDRESS,to:RETIRED_ROUTER,value:1000000n,validAfter:0n,validBefore:BigInt(r.authorization.validBefore),nonce:refundNonce(id,payer,r.authorization.salt)}));expect(r.challenge).toBe(b64urlEncode(Uint8Array.from(Buffer.from(digest.slice(2),'hex'))));
});
it('migration aborts rather than guesses a racing/unclassified successful invoice',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE invoices(id TEXT PRIMARY KEY,status TEXT,create_tx_hash TEXT)');db.prepare('INSERT INTO invoices VALUES(?,?,?)').run('new-since-snapshot','open','0xcreation');
 expect(()=>db.exec(readFileSync(new URL('../../migrations/0071_invoice_protocol.sql',import.meta.url),'utf8'))).toThrow();
});
