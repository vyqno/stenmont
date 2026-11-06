import { createPublicClient, encodeFunctionData, http, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { whitechainSepolia } from "@stenmont/shared";
import type { Context } from "hono";
import type { AppEnv } from "../app";
import { sendFromTank } from "../relayer/tankSend";

export type AnchorReceipt={txHash:Hex;confirmed:boolean;root:Hex;lineCount:number};
export type AnchorAdapter=(root:Hex,period:string)=>Promise<AnchorReceipt>;
/** Injectable anchor(root, period). An accepted transaction hash alone is never proof of anchoring. */
export async function anchorMonth(root:Hex,period:string,lineCount:number,anchor?:AnchorAdapter):Promise<AnchorReceipt>{
  if(!anchor) throw new Error("anchor_not_configured");
  const receipt=await anchor(root,period);
  if(!receipt.confirmed) throw new Error("anchor_unconfirmed");
  if(receipt.root.toLowerCase()!==root.toLowerCase()||receipt.lineCount!==lineCount) throw new Error("anchor_mismatch");
  return receipt;
}
// Narrow local interface supplied by the LedgerAnchor contract workstream. No generated ABI/deployment edits.
const registryAbi=parseAbi([
  "function anchor(address merchant,bytes32 periodId,bytes32 root,uint256 lineCount,uint256 deadline,bytes merchantSig)",
  "function nonces(address merchant) view returns (uint256)",
  "function anchors(address merchant,bytes32 periodId) view returns (bytes32 root,uint256 lineCount)",
]);
export const anchorPeriodId=(period:string)=>keccak256(stringToHex(period));
export function anchorReader(c:Context<AppEnv>){return createPublicClient({chain:whitechainSepolia,transport:http(c.env.WHITECHAIN_RPC)});}
export function registryAdapter(c:Context<AppEnv>,consent:{signature:Hex;deadline:bigint;lineCount:number}):AnchorAdapter|undefined {
  if(!c.env.ANCHOR_REGISTRY) return undefined;
  const registry=c.env.ANCHOR_REGISTRY as Address,merchant=c.var.merchant.address as Address;
  return async(root,period)=>{
    const periodId=anchorPeriodId(period);
    const data=encodeFunctionData({abi:registryAbi,functionName:"anchor",args:[merchant,periodId,root,BigInt(consent.lineCount),consent.deadline,consent.signature]});
    const sent=await sendFromTank({db:c.var.db,chain:c.var.chain,now:c.var.now()},c.var.merchantId,{to:registry,data});
    if(!sent.ok) throw new Error(`anchor_${sent.code}`);
    const [recordedRoot,lineCount]=await anchorReader(c).readContract({address:registry,abi:registryAbi,functionName:"anchors",args:[merchant,periodId]});
    return {txHash:sent.txHash,confirmed:true,root:recordedRoot,lineCount:Number(lineCount)};
  };
}
export async function anchorIntent(c:Context<AppEnv>,period:string,root:Hex,lineCount:number){
  if(!c.env.ANCHOR_REGISTRY) throw new Error("anchor_not_configured");
  const merchant=c.var.merchant.address as Address;
  const nonce=await anchorReader(c).readContract({address:c.env.ANCHOR_REGISTRY as Address,abi:registryAbi,functionName:"nonces",args:[merchant]});
  return {domain:{name:"Stenmont LedgerAnchor",version:"1",chainId:Number(c.env.WHITECHAIN_CHAIN_ID),verifyingContract:c.env.ANCHOR_REGISTRY},primaryType:"Anchor",types:{Anchor:[{name:"merchant",type:"address"},{name:"periodId",type:"bytes32"},{name:"root",type:"bytes32"},{name:"lineCount",type:"uint256"},{name:"nonce",type:"uint256"},{name:"deadline",type:"uint256"}]},message:{merchant,periodId:anchorPeriodId(period),root,lineCount:String(lineCount),nonce:nonce.toString(),deadline:String(Math.floor(c.var.now().getTime()/1000)+600)}};
}
