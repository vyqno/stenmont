import { encodeFunctionData,encodeAbiParameters,keccak256,type Address,type Hex } from 'viem';
import { paymentRouterAbi,payNonce } from '@stenmont/shared';
import { paymentRouterV2Abi } from '../../../../packages/shared/src/abis/v2/paymentRouterV2';
import type { CreateInvoiceRequest } from '../chain';
import type { ContractVersion } from '../protocol';
export { paymentRouterV2Abi };
export { invoiceClaimV2Abi } from '../../../../packages/shared/src/abis/v2/invoiceClaimV2';
export { invoiceAckAbi } from '../../../../packages/shared/src/abis/v2/invoiceAck';
export { reputationRegistryV2Abi } from '../../../../packages/shared/src/abis/v2/reputationRegistryV2';
export function createCall(router:Address,version:ContractVersion,req:CreateInvoiceRequest){
 const data=version==='v2'
  ?encodeFunctionData({abi:paymentRouterV2Abi,functionName:'createInvoiceAsCreator',args:[{...req,discountBps:req.discountBps??0,discountUntil:req.discountUntil??0n}]})
  :encodeFunctionData({abi:paymentRouterAbi,functionName:'createInvoiceAsCreator',args:[req]});
 return {to:router,data};
}
export type PayAuth={payer:Address;validAfter:bigint;validBefore:bigint;salt:Hex;signature:Hex};
export function payCall(router:Address,version:ContractVersion,id:Hex,value:bigint,payout:Address,auth:PayAuth){
 const data=version==='v2'?encodeFunctionData({abi:paymentRouterV2Abi,functionName:'pay',args:[id,value,payout,auth]}):encodeFunctionData({abi:paymentRouterAbi,functionName:'pay',args:[id,value,auth]});
 return {to:router,data};
}
export function payAuthorizationNonce(version:ContractVersion,id:Hex,payout:Address,salt:Hex){
 return version==='v1'?payNonce(id,salt):keccak256(encodeAbiParameters([{type:'string'},{type:'bytes32'},{type:'address'},{type:'bytes32'}],['STENMONT_PAY_V2',id,payout,salt]));
}
