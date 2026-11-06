import { expect,it } from 'vitest';
import { decodeFunctionData,zeroAddress } from 'viem';
import { createCall,payCall,payAuthorizationNonce } from '../../src/v2/encoding';
import { paymentRouterV2Abi } from '../../../../packages/shared/src/abis/v2/paymentRouterV2';
const router=`0x${'3'.repeat(40)}` as const,id=`0x${'4'.repeat(64)}` as const,payout=`0x${'5'.repeat(40)}` as const;
it('encodes actual v2 tuple and expected payout instead of v1 calldata',()=>{
 const req={merchant:payout,ref:id,payout,payerLock:payout,amount:1000000n,minPayment:0n,dueDate:100n,discountBps:200,discountUntil:50n,metaHash:id,deadline:10n};
 const made=createCall(router,'v2',req);expect(made.to).toBe(router);
 expect(decodeFunctionData({abi:paymentRouterV2Abi,data:made.data}).args?.[0]).toMatchObject({discountBps:200,discountUntil:50n,payerLock:payout});
 const auth={payer:payout,validAfter:0n,validBefore:51n,salt:id,signature:'0x12' as const};
 const paid=payCall(router,'v2',id,980000n,payout,auth);
 expect(decodeFunctionData({abi:paymentRouterV2Abi,data:paid.data}).args?.slice(0,3)).toEqual([id,980000n,payout]);
 expect(payAuthorizationNonce('v2',id,payout,id)).not.toBe(payAuthorizationNonce('v1',id,zeroAddress,id));
});
