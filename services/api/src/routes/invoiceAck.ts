import {Hono,type Context} from 'hono';
import {eq} from 'drizzle-orm';
import {hashTypedData,encodeFunctionData,zeroAddress,type Address,type Hex} from 'viem';
import {b64urlEncode,fromUnits} from '@stenmont/shared';
import {z} from 'zod';
import type {AppEnv} from '../app';
import {invoices} from '../db/schema';
import {invoiceProtocol,versionChain} from '../protocol';
import {fail} from '../errors';
import {invalid,idSchema} from '../lib/validation';
import {hitRateLimit} from '../relayer/caps';
import {sendFromTank} from '../relayer/tankSend';
import {invoiceAckAbi} from '../v2/encoding';
const buyerSchema=z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const ackTypes={InvoiceAck:[{name:'invoiceId',type:'bytes32'},{name:'amount',type:'uint128'},{name:'dueDate',type:'uint64'},{name:'buyer',type:'address'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]} as const;
export const invoiceAckRoutes=new Hono<AppEnv>();
async function context(c:Context<AppEnv>){
 const id=c.req.param('id');if(!id||!idSchema.safeParse(id).success)return null;
 const [inv]=await c.var.db.select().from(invoices).where(eq(invoices.id,id));
 if(!inv||inv.contractVersion!=='v2'||!c.env.INVOICE_ACK_ADDRESS)return null;
 const protocol=invoiceProtocol(c.env,inv),chain=versionChain(c.var.chain,'v2');
 if(!chain.invoiceDetails||!chain.acknowledgement)throw Error('Acknowledgement adapter unavailable');
 const detail=await chain.invoiceDetails(id as Hex);
 if(detail.payerLock===zeroAddress||detail.status!==1||detail.payout.toLowerCase()!==inv.payout?.toLowerCase())return null;
 return {inv,protocol,chain,detail};
}
invoiceAckRoutes.post('/pay/:id/ack-request',async c=>{
 const p=z.strictObject({buyer:buyerSchema}).safeParse(await c.req.json().catch(()=>null));if(!p.success)return invalid(c,p.error);
 const got=await context(c);if(!got)return fail(c,404,'not_acknowledgeable','This invoice cannot be acknowledged.');
 const {inv,chain,detail,protocol}=got;
 if(p.data.buyer.toLowerCase()!==detail.payerLock.toLowerCase())return fail(c,422,'wrong_payer','Only the nominated buyer can acknowledge this invoice.');
 if(!await hitRateLimit(c.var.db,`ack:${inv.id}`,30,60,c.var.now()))return fail(c,429,'rate_limited','Too many acknowledgement requests.');
 const state=await chain.acknowledgement!(inv.id as Hex,detail.payerLock);if(state.ackedAt>0n)return fail(c,409,'already_acknowledged','This invoice is already acknowledged.');
 const deadline=Math.floor(c.var.now().getTime()/1000)+600;
 const typedData={domain:{name:'Stenmont InvoiceAck',version:'1',chainId:Number(c.env.WHITECHAIN_CHAIN_ID),verifyingContract:c.env.INVOICE_ACK_ADDRESS as Address},types:ackTypes,primaryType:'InvoiceAck' as const,message:{invoiceId:inv.id as Hex,amount:detail.amount,dueDate:detail.dueDate,buyer:detail.payerLock,nonce:state.nonce,deadline:BigInt(deadline)}};
 const digest=hashTypedData(typedData);
 return c.json({contractVersion:'v2',routerAddress:protocol.router,ackAddress:c.env.INVOICE_ACK_ADDRESS,buyer:detail.payerLock,nonce:state.nonce.toString(),deadline,digest,challenge:b64urlEncode(Uint8Array.from(Buffer.from(digest.slice(2),'hex'))),typedData:JSON.parse(JSON.stringify(typedData,(_,v)=>typeof v==='bigint'?v.toString():v))});
});
invoiceAckRoutes.post('/pay/:id/ack',async c=>{
 const p=z.strictObject({buyer:buyerSchema,deadline:z.number().int().positive(),signature:z.string().regex(/^0x([0-9a-fA-F]{2}){1,2048}$/)}).safeParse(await c.req.json().catch(()=>null));if(!p.success)return invalid(c,p.error);
 const now=Math.floor(c.var.now().getTime()/1000);if(p.data.deadline<=now||p.data.deadline>now+600)return fail(c,400,'expired','Request a new acknowledgement challenge.');
 const got=await context(c);if(!got)return fail(c,404,'not_acknowledgeable','This invoice cannot be acknowledged.');
 const {inv,chain,detail}=got;
 if(p.data.buyer.toLowerCase()!==detail.payerLock.toLowerCase())return fail(c,422,'wrong_payer','Only the nominated buyer can acknowledge this invoice.');
 if(!await hitRateLimit(c.var.db,`ack-submit:${inv.id}`,5,600,c.var.now()))return fail(c,429,'rate_limited','Too many acknowledgement attempts.');
 const sent=await sendFromTank({db:c.var.db,chain,now:c.var.now()},inv.merchantId,{to:c.env.INVOICE_ACK_ADDRESS as Address,data:encodeFunctionData({abi:invoiceAckAbi,functionName:'acknowledge',args:[inv.id as Hex,BigInt(p.data.deadline),p.data.signature as Hex]})});
 if(!sent.ok)return fail(c,sent.code==='rejected'?422:502,sent.code,'Acknowledgement was not confirmed.');
 const state=await chain.acknowledgement!(inv.id as Hex,detail.payerLock);
 if(state.ackedAt===0n)return fail(c,502,'unconfirmed','Acknowledgement was not confirmed by the contract.');
 return c.json({txHash:sent.txHash,ackedAt:state.ackedAt.toString()});
});
invoiceAckRoutes.get('/pay/:id/financing-quote',async c=>{
 const got=await context(c);if(!got)return fail(c,404,'not_found','A nominated-buyer v2 invoice is required.');
 const {inv,chain,detail}=got;
 if(!await hitRateLimit(c.var.db,`quote:${inv.id}`,30,60,c.var.now()))return fail(c,429,'rate_limited','Too many quote requests.');
 const [ack,r]=await Promise.all([chain.acknowledgement!(inv.id as Hex,detail.payerLock),chain.reputationOf(detail.payerLock)]);
 const count=r.onTimeCounterparties??0;
 // Advisory, transparent heuristic: distinct addresses are not proof of independent humans.
 const suggestedDiscountBps=Math.max(100,500-Math.min(count,10)*20-(ack.ackedAt>0n?100:0));
 return c.json({contractVersion:'v2',acknowledged:ack.ackedAt>0n,ackedAt:ack.ackedAt.toString(),buyerRecord:{onTime:r.onTime,late:r.late,volume:fromUnits(r.volume),onTimeCounterparties:count},suggestedDiscountBps,advisory:true,eligibleForFinancing:detail.discountBps===0,limits:'Distinct addresses are not independently verified humans; this quote does not guarantee funding or repayment.'});
});
