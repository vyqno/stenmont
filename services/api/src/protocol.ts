import { isAddress, zeroAddress, type Address } from 'viem';
import type { Env } from './env';
import type { ChainClient } from './chain';
export type ContractVersion='v1'|'v2';
export const RETIRED_ROUTER='0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929' as Address;
export const RETIRED_ROUTER_DEPLOY_BLOCK='12312560';
type Provenance={contractVersion?:string;routerAddress?:string|null;claimAddress?:string|null};
export function creationVersion(env:Env):ContractVersion {
 if(env.INVOICE_DEFAULT_VERSION===undefined||env.INVOICE_DEFAULT_VERSION==='1')return 'v1';
 if(env.INVOICE_DEFAULT_VERSION==='2')return 'v2';
 throw Error('Invalid invoice creation version');
}
export function invoiceProtocol(env:Env,row:Provenance={contractVersion:'v1'}):{version:ContractVersion;router:Address;claim:Address;retired:boolean} {
 const version=row.contractVersion??'v1';if(version!=='v1'&&version!=='v2')throw Error('Unknown invoice version');
 const router=version==='v2'?env.ROUTER_V2_ADDRESS:row.routerAddress??env.ROUTER_ADDRESS;
 const retired=version==='v1'&&router?.toLowerCase()!==env.ROUTER_ADDRESS.toLowerCase();
 if(retired&&router?.toLowerCase()!==RETIRED_ROUTER.toLowerCase())throw Error('Unsupported retired invoice router');
 const claim=version==='v2'?env.INVOICE_CLAIM_V2_ADDRESS:retired?zeroAddress:env.INVOICE_CLAIM_ADDRESS;
 if(!router||!claim||!isAddress(router)||!isAddress(claim)||router===zeroAddress||(!retired&&claim===zeroAddress))throw Error('Invoice contracts unconfigured');
 if(version==='v2'&&row.routerAddress&&row.routerAddress.toLowerCase()!==router.toLowerCase())throw Error('Invoice router provenance mismatch');
 if(row.claimAddress&&row.claimAddress.toLowerCase()!==claim.toLowerCase())throw Error('Invoice claim provenance mismatch');
 return {version,router:router as Address,claim:claim as Address,retired};
}
export function versionChain(chain:ChainClient,version:ContractVersion,router?:Address,defaultRouter?:string):ChainClient {
 if(version!=='v1'&&version!=='v2')throw Error('Unknown invoice version');
 if(version==='v1'){
  if(router&&defaultRouter&&router.toLowerCase()!==defaultRouter.toLowerCase()){if(!chain.forRouter)throw Error('Retired router adapter unavailable');return chain.forRouter(router);}
  return chain;
 }
 if(!chain.forVersion)throw Error('Versioned chain adapter unavailable');
 return chain.forVersion(version);
}
/** M-2: a discounted authorization must expire at the token's exclusive end of the inclusive offer window. */
export function discountGuard(inv:{payerLock:string|null;discountBps:number;discountUntil:number|null;amount:string;amountPaid:string},i:{payer:string;value:bigint;validBefore:bigint},now:bigint):'wrong_payer'|'invalid_authorization'|null {
 if(inv.payerLock&&inv.payerLock.toLowerCase()!==zeroAddress&&inv.payerLock.toLowerCase()!==i.payer.toLowerCase())return 'wrong_payer';
 if(inv.discountBps>0&&BigInt(inv.amountPaid)===0n&&i.value<BigInt(inv.amount)){
  if(!inv.payerLock||inv.payerLock.toLowerCase()===zeroAddress||!inv.discountUntil)return 'invalid_authorization';
  const end=BigInt(inv.discountUntil);
  const discounted=BigInt(inv.amount)-BigInt(inv.amount)*BigInt(inv.discountBps)/10000n;
  if(now>end||i.value!==discounted||i.validBefore>end+1n||i.validBefore<=now)return 'invalid_authorization';
 }
 return null;
}
