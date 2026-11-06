/** Read-only Sepolia inspection. No .env file, signer, sendTransaction or writeContract is used. */
import { createPublicClient, fallback, http } from "viem";
import { sepolia } from "viem/chains";
import { readNameAuthority } from "../services/api/src/ens/authority";
const name=process.argv[2]??"e2emw4k3tmp.stenmont.eth";
if(!/^[a-z0-9-]+\.stenmont\.eth$/.test(name))throw Error("Supply a business under stenmont.eth");
const client=createPublicClient({chain:sepolia,transport:fallback([http("https://ethereum-sepolia-rpc.publicnode.com"),http("https://sepolia.gateway.tenderly.co")])});
const registry="0xE100C72C3BD9781a7AE4d653E0518b54888A5f0c" as const;
const registrar="0x96b8b60c0f93D4a2519f0a3d90c9B7eF555196a9" as const;
import { ensRegistryAbi } from "@stenmont/shared";
const resolver=await client.readContract({address:registry,abi:ensRegistryAbi,functionName:"getResolver",args:[name.split(".")[0]!]});
if(resolver==="0x0000000000000000000000000000000000000000")throw Error("No active resolver");
const report=await readNameAuthority(client,{name,registry,resolver,registrar,member:registrar});
console.log(JSON.stringify(report,null,2));
