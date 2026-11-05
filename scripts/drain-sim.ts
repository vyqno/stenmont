// Live drain simulation against a deployed environment (staging by default). Two attacks on the public relay:
//   1. one valid signed authorization replayed 15 times at once
//   2. 120 fresh but invalid authorizations from one payer
// Expected: exactly one payment is sent, and the relayer's wallet and the merchant's gas tank pay for that one only.
//   STENMONT_E2E_API_KEY=sk_test_... pnpm --filter @stenmont/scripts drain-sim
import { createPublicClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildReceiveAuth, formatUSDT, payNonce, paymentRouterAbi, toUnits, deployments, whitechainSepolia } from "@stenmont/shared";

const API = process.env.E2E_API_URL ?? "https://api-staging.stenmont.com";
const KEY = process.env.STENMONT_E2E_API_KEY;
const demoKey = process.env.STENMONT_DEMO_PAYER_PRIVATE_KEY as Hex | undefined;
const relayerAddress = process.env.STENMONT_RELAYER_ADDRESS as Hex | undefined;
if (!KEY || !demoKey || !relayerAddress) throw new Error("needs STENMONT_E2E_API_KEY, STENMONT_DEMO_PAYER_PRIVATE_KEY, STENMONT_RELAYER_ADDRESS");

const router = deployments.environments.staging.PaymentRouter.address;
const payer = privateKeyToAccount(demoKey);
const client = createPublicClient({ chain: whitechainSepolia, transport: http(process.env.WHITECHAIN_RPC) });
const auth = { authorization: `Bearer ${KEY}` };
const tally = (codes: (string | number)[]) => Object.entries(codes.reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {})).map(([k, v]) => `${k}×${v}`).join("  ");

const tank = async () => (await (await fetch(`${API}/v1/gas-tank`, { headers: auth })).json()) as { balance: string; spentToday: string };
const wbt = (s: string) => BigInt(Math.round(Number(s) * 1e18));

const created = await fetch(`${API}/v1/invoices`, { method: "POST", headers: { ...auth, "idempotency-key": crypto.randomUUID(), "content-type": "application/json" }, body: JSON.stringify({ amount: "2.00" }) });
const invoice = (await created.json()) as { id: Hex };
const before = { tank: await tank(), relayer: await client.getBalance({ address: relayerAddress }) };

// 1. replay one valid authorization, concurrently
const now = BigInt(Math.floor(Date.now() / 1000));
const salt = keccak256(toBytes(`drain-${now}`));
const validBefore = now + 3_600n;
const signature = await payer.signTypedData(buildReceiveAuth({ from: payer.address, to: router, value: toUnits("1"), validAfter: 0n, validBefore, nonce: payNonce(invoice.id, salt) }));
const body = JSON.stringify({ invoiceId: invoice.id, value: "1", payer: payer.address, validAfter: "0", validBefore: validBefore.toString(), salt, signature });
const replay = await Promise.all(Array.from({ length: 15 }, () => fetch(`${API}/relay/pay`, { method: "POST", headers: { "content-type": "application/json" }, body }).then((r) => r.status)));
console.log(`replay x15 (concurrent):   ${tally(replay)}`);

// 2. flood of invalid authorizations from one payer (concurrency 10)
const fake = "0x00000000000000000000000000000000000000aa";
const flood: number[] = [];
for (let i = 0; i < 120; i += 10) {
  flood.push(...(await Promise.all(Array.from({ length: 10 }, (_, j) =>
    fetch(`${API}/relay/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId: invoice.id, value: "1", payer: fake, validAfter: "0", validBefore: "9999999999", salt: keccak256(toBytes(`flood-${now}-${i + j}`)), signature: `0x${"22".repeat(65)}` }) }).then((r) => r.status)))));
}
console.log(`flood x120 (bad auth):     ${tally(flood)}`);

await new Promise((r) => setTimeout(r, 4_000));
const after = { tank: await tank(), relayer: await client.getBalance({ address: relayerAddress }) };
const paid = (await client.readContract({ address: router, abi: paymentRouterAbi, functionName: "invoices", args: [invoice.id] })).paid;
const tankSpent = wbt(after.tank.spentToday) - wbt(before.tank.spentToday);
const relayerSpent = before.relayer - after.relayer;
console.log(`invoice paid onchain:      ${formatUSDT(paid)} (one payment of $1.00 expected)`);
console.log(`merchant tank charged:     ${tankSpent} wei`);
console.log(`relayer wallet spent:      ${relayerSpent} wei`);

const successes = replay.filter((s) => s === 200).length;
const ok = successes === 1 && paid === toUnits("1") && flood.every((s) => s === 422 || s === 429) && tankSpent > 0n && tankSpent <= relayerSpent * 2n && relayerSpent < 5n * 10n ** 15n;
console.log(ok ? "PASS: one payment sent, the flood cost nothing" : "FAIL: unexpected spend or status");
process.exit(ok ? 0 : 1);
