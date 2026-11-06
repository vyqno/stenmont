import { expect,it } from 'vitest';
import { creationVersion, invoiceProtocol, discountGuard } from '../../src/protocol';
import { baseEnv } from '../helpers/app';
const env={...baseEnv({} as D1Database),ROUTER_V2_ADDRESS:`0x${'3'.repeat(40)}`,INVOICE_CLAIM_V2_ADDRESS:`0x${'4'.repeat(40)}`};
it('new creation defaults v1 and invalid cutover fails closed',()=>{
 expect(creationVersion(env)).toBe('v1');expect(creationVersion({...env,INVOICE_DEFAULT_VERSION:'2'})).toBe('v2');
 expect(()=>creationVersion({...env,INVOICE_DEFAULT_VERSION:'other'})).toThrow();
});
it('invoice provenance wins over the creation cutover',()=>{
 const p=invoiceProtocol({...env,INVOICE_DEFAULT_VERSION:'2'},{contractVersion:'v1',routerAddress:env.ROUTER_ADDRESS,claimAddress:env.INVOICE_CLAIM_ADDRESS});
 expect(p.router).toBe(env.ROUTER_ADDRESS);expect(p.version).toBe('v1');
 expect(()=>invoiceProtocol(env,{contractVersion:'v2',routerAddress:env.ROUTER_ADDRESS})).toThrow();
});
it('discount cannot be dust-front-run by another payer or submitted with loose or late authorization',()=>{
 const now=100n, buyer=`0x${'5'.repeat(40)}`;
 const inv={payerLock:buyer,discountBps:200,discountUntil:110,amount:'1000000',amountPaid:'0'};
 expect(discountGuard(inv,{payer:buyer,value:980000n,validBefore:111n},now)).toBeNull();
 expect(discountGuard(inv,{payer:`0x${'6'.repeat(40)}`,value:980000n,validBefore:111n},now)).toBe('wrong_payer');
 expect(discountGuard(inv,{payer:buyer,value:980000n,validBefore:112n},now)).toBe('invalid_authorization');
 expect(discountGuard(inv,{payer:buyer,value:980000n,validBefore:111n},112n)).toBe('invalid_authorization');
});
