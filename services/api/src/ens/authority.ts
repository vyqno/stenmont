import { decodeAbiParameters, parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { labelhash, namehash } from "viem/ens";
import { AGENT_CONTEXT_KEY, PROFILE_KEY, addrQuery, describeEnsAuthority, dnsName, ensRegistryAbi, permissionedResolverAbi, textResource } from "@stenmont/shared";
const registryReadAbi=parseAbi(["function roles(uint256 anyId,address account) view returns(uint256)"]);
const recordReadAbi=parseAbi(["function getRecordId(bytes32 node) view returns(uint256)"]);
export type AuthorityInput={name:string;registry:Address;resolver:Address;member:Address;registrar:Address};
/** No signing capability. Every value is observed at one block; any failed read rejects the report. */
export async function readNameAuthority(reader:Pick<PublicClient,"getBlock"|"readContract">,a:AuthorityInput){
 const block=await reader.getBlock();if(block.number===null)throw Error("Unconfirmed ENS block");
 const at={blockNumber:block.number};
 const state=await reader.readContract({...at,address:a.registry,abi:ensRegistryAbi,functionName:"getState",args:[BigInt(labelhash(a.name.split(".")[0]!))]});
 const activeResolver=await reader.readContract({...at,address:a.registry,abi:ensRegistryAbi,functionName:"getResolver",args:[a.name.split(".")[0]!]});
 const ownerRoles=state.latestOwner===zeroAddress?0n:await reader.readContract({...at,address:a.registry,abi:registryReadAbi,functionName:"roles",args:[state.tokenId,state.latestOwner]});
 const roles=async(resource:bigint,account:Address)=>reader.readContract({...at,address:a.resolver,abi:permissionedResolverAbi,functionName:"roles",args:[resource,account]});
 const memberRoot=await roles(0n,a.member),registrarRoot=await roles(0n,a.registrar);
 const profileRoles=(await roles(textResource(PROFILE_KEY),a.member))|memberRoot;
 const contextRoles=(await roles(textResource(AGENT_CONTEXT_KEY),a.member))|memberRoot;
 const recordId=await reader.readContract({...at,address:a.resolver,abi:recordReadAbi,functionName:"getRecordId",args:[namehash(a.name)]});
 const resolve=async(name:string)=>decodeAbiParameters([{type:"address"}],await reader.readContract({...at,address:a.resolver,abi:permissionedResolverAbi,functionName:"resolve",args:[dnsName(name),addrQuery(name)]}))[0];
 const directPayout=await resolve(a.name),probe=`inv-1.${a.name}`,invoiceAddress=await resolve(probe);
 return {name:a.name,member:a.member,blockNumber:block.number.toString(),blockTimestamp:block.timestamp.toString(),owner:state.latestOwner,expiry:state.expiry.toString(),status:state.status,activeResolver,recordId:recordId.toString(),directPayout,
  roleBitmaps:{ownerToken:ownerRoles.toString(),memberRoot:memberRoot.toString(),profile:profileRoles.toString(),context:contextRoles.toString(),registrarRoot:registrarRoot.toString()},
  authority:describeEnsAuthority({status:state.status,expiry:state.expiry,now:block.timestamp,ownerRoles,linkRoles:registrarRoot,profileRoles,contextRoles}),
  invoiceProbe:{name:probe,address:invoiceAddress,meaning:"Direct resolver observation only; an address is not proof of a current cross-chain claim holder."},
 };
}
