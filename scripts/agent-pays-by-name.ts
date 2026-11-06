// An AI agent given only an ENS name finds how to pay it, then pays within its limits. Reads the business's pay directory
// (ENS text records, docs/ENS_DIRECTORY.md) on Sepolia, validates it, calls the x402 endpoint it names and pays in USDT.
//   pnpm --filter @stenmont/scripts agent-pays-by-name label.stenmont.eth [--max-per-request 0.05] [--daily 1.00] [--path /x]
import { createPublicClient, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { parseArgs, payByName } from "./agent-pays-by-name-lib";

const args = parseArgs(process.argv.slice(2));
const key = process.env.STENMONT_DEMO_PAYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("missing STENMONT_DEMO_PAYER_PRIVATE_KEY in .env");
const account = privateKeyToAccount(key);
// Reads fall back across providers: the shared gateways rate-limit, and one of them may be down.
const rpcs = [process.env.SEPOLIA_RPC, "https://ethereum-sepolia-rpc.publicnode.com"].filter((u): u is string => !!u);
const client = createPublicClient({ chain: sepolia, transport: fallback(rpcs.map((u) => http(u)), { retryCount: 2 }) });
const explorer = "https://explorer.testnet.whitechain.io/tx/";

console.log("agent account:", account.address);
const r = await payByName(args, { account, read: (name, k) => client.getEnsText({ name, key: k }) });
if (!r.ok) {
  console.log(`refused at ${r.stage}:`, r.reason);
  process.exitCode = 1;
} else {
  console.log("business:", r.business.name, "pays at", r.url);
  console.log("status:", r.status);
  console.log("answer:", r.body);
  if (r.receipt) {
    const t = JSON.parse(Buffer.from(r.receipt, "base64").toString()) as { success: boolean; transaction: string };
    console.log("settled:", t.success, explorer + t.transaction);
  }
}
