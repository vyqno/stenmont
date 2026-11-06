// An AI agent pays for an API call in USDT over x402, settled by our facilitator. Then an over-limit attempt is refused
// before anything is signed.
//   pnpm --filter @stenmont/scripts agent-pays [url]
import { createAgentFetch, LimitExceeded } from "@stenmont/agent";
import { privateKeyToAccount } from "viem/accounts";

const url = process.argv[2] ?? "https://shop-staging.stenmont.com/api/premium/quote";
const key = process.env.STENMONT_DEMO_PAYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("missing STENMONT_DEMO_PAYER_PRIVATE_KEY in .env");
const account = privateKeyToAccount(key);
const host = new URL(url).hostname;
const explorer = "https://explorer.testnet.whitechain.io/tx/";

console.log("agent account:", account.address);

// 1. an agent with sensible limits pays 0.01 USDT
const agent = createAgentFetch({ account, maxPerRequest: "0.05", dailyLimit: "1.00", allowedHosts: [host] });
const res = await agent(url);
console.log("status:", res.status);
console.log("answer:", await res.text());
const receipt = res.headers.get("payment-response");
if (receipt) {
  const r = JSON.parse(Buffer.from(receipt, "base64").toString()) as { success: boolean; transaction: string };
  console.log("settled:", r.success, explorer + r.transaction);
}

// 2. an agent that may spend at most 0.001 per request is refused before it signs anything
const frugal = createAgentFetch({ account, maxPerRequest: "0.001", dailyLimit: "1.00", allowedHosts: [host] });
try {
  await frugal(url);
  console.log("UNEXPECTED: the over-limit request was allowed");
  process.exitCode = 1;
} catch (e) {
  if (e instanceof LimitExceeded) console.log("refused client-side:", e.reason);
  else throw e;
}

// 3. a host that is not allowed is refused too
const narrow = createAgentFetch({ account, maxPerRequest: "0.05", dailyLimit: "1.00", allowedHosts: ["example.com"] });
try {
  await narrow(url);
  console.log("UNEXPECTED: the unlisted host was allowed");
  process.exitCode = 1;
} catch (e) {
  if (e instanceof LimitExceeded) console.log("refused client-side:", e.reason);
  else throw e;
}
