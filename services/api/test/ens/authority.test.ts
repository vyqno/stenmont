import { describe, expect, it } from "vitest";
import { readNameAuthority } from "../../src/ens/authority";
import { encodeAbiParameters, zeroAddress } from "viem";
const owner="0x1111111111111111111111111111111111111111" as const, member="0x2222222222222222222222222222222222222222" as const;
const resolver="0x3333333333333333333333333333333333333333" as const;
describe("pinned ENS read-only authority inspection",()=>{
 it("pins every read and distinguishes an absent wildcard from a normal payout",async()=>{
  const reads:any[]=[];
  const reader:any={getBlock:async()=>({number:12n,timestamp:1000n}),readContract:async(a:any)=>{reads.push(a);if(a.functionName==="getState")return {status:2,expiry:2000n,latestOwner:owner,tokenId:9n,resource:10n};if(a.functionName==="getResolver")return resolver;if(a.functionName==="getRecordId")return 1n;if(a.functionName==="roles")return 0n;if(a.functionName==="resolve")return encodeAbiParameters([{type:"address"}],[reads.filter(r=>r.functionName==="resolve").length===1?owner:zeroAddress]);throw Error("unexpected write");}};
  const r=await readNameAuthority(reader,{name:"acme.stenmont.eth",registry:resolver,resolver,member,registrar:owner});
  expect(r.blockNumber).toBe("12");expect(r.directPayout).toBe(owner);expect(r.invoiceProbe.address).toBe(zeroAddress);expect(r.authority.invoiceHolderWildcard).toBe(false);
  expect(reads.every(r=>r.blockNumber===12n)).toBe(true);expect(reads.every(r=>["getState","getResolver","roles","getRecordId","resolve"].includes(r.functionName))).toBe(true);
 });
 it("fails closed on an RPC error rather than inventing zero roles",async()=>{
  const reader:any={getBlock:async()=>({number:12n,timestamp:1000n}),readContract:async()=>{throw Error("RPC unavailable");}};
  await expect(readNameAuthority(reader,{name:"acme.stenmont.eth",registry:resolver,resolver,member,registrar:owner})).rejects.toThrow("RPC unavailable");
 });
});
