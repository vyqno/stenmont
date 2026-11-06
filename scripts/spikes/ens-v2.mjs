// Spike 5.1: read the live ENSv2 contracts on Sepolia and pin the exact function shapes we will call.
//   node spikes/ens-v2.mjs   (from the scripts folder)
import { createPublicClient, http, keccak256, toFunctionSelector, stringToBytes, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { labelhash, namehash } from "viem/ens";

const client = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC ?? "https://sepolia.gateway.tenderly.co") });
const UR = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
const ETH_REGISTRY = "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4";
const RESOLVER_IMPL = "0x115eb53F0c60696633855F90b138178Fb40b2b2C";
const REGISTRY_IMPL = "0x9BD8a88719068D09ecee662f36C0E3856708366a";

const registry = parseAbi([
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

const state = await client.readContract({ address: ETH_REGISTRY, abi: registry, functionName: "getState", args: [BigInt(labelhash("stenmont"))] });
console.log("stenmont.eth state:", state);
console.log("subregistry:", await client.readContract({ address: ETH_REGISTRY, abi: registry, functionName: "getSubregistry", args: ["stenmont"] }));
console.log("resolver   :", await client.readContract({ address: ETH_REGISTRY, abi: registry, functionName: "getResolver", args: ["stenmont"] }).catch((e) => `n/a (${e.shortMessage})`));
console.log("universal resolver isENSv2:", await client.readContract({ address: UR, abi: parseAbi(["function isENSv2() view returns (bool)"]), functionName: "isENSv2" }));

// Which setter shape does the DEPLOYED resolver implementation have? Look for the 4-byte selectors in its bytecode.
const code = await client.getCode({ address: RESOLVER_IMPL });
for (const sig of ["setText(bytes,string,string)", "setText(bytes32,string,string)", "setAddress(bytes,uint256,bytes)", "initialize((address,uint256)[],bytes[])", "initialize(address,uint256,bytes[])", "grantRoles(uint256,uint256,address)"]) {
  console.log(code.includes(toFunctionSelector(sig).slice(2)) ? "HAS " : "no  ", sig);
}
const rcode = await client.getCode({ address: REGISTRY_IMPL });
for (const sig of ["initialize((address,uint256)[])", "register(string,address,address,address,uint256,uint64)", "setResolver(uint256,address)", "setSubregistry(uint256,address)", "grantRoles(uint256,uint256,address)"]) {
  console.log(rcode.includes(toFunctionSelector(sig).slice(2)) ? "HAS " : "no  ", "registry", sig);
}
console.log("namehash(stenmont.eth) =", namehash("stenmont.eth"));
void keccak256; void stringToBytes;
