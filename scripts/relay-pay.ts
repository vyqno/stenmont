// Pays an invoice through the PUBLIC relay API, the way a customer's browser does: the payer signs a USDT
// authorization bound to the invoice and the relayer pays the gas. The demo payer holds no WBT.
//   pnpm --filter @stenmont/scripts relay-pay <invoiceId> <amount> [apiBase]
import { createPublicClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildReceiveAuth, formatUSDT, payNonce, toUnits, whitechainSepolia } from "@stenmont/shared";

const [id, amountArg, apiArg] = process.argv.slice(2) as [Hex | undefined, string | undefined, string | undefined];
if (!id || !/^0x[0-9a-f]{64}$/.test(id) || !amountArg) throw new Error("usage: relay-pay <invoiceId 0x…> <amount> [apiBase]");
const api = apiArg ?? "https://api-staging.stenmont.com";
const key = process.env.STENMONT_DEMO_PAYER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("missing STENMONT_DEMO_PAYER_PRIVATE_KEY in .env");
const payer = privateKeyToAccount(key);
const router = (await (await fetch(`${api}/health`)).json(), process.env.ROUTER_ADDRESS ?? "0x4c32942616d2BBeDD34bA1178bBF5823FDbbdDC0") as Hex;

const value = toUnits(amountArg);
const now = BigInt(Math.floor(Date.now() / 1000));
const salt = keccak256(toBytes(`relay-${now}-${Math.random()}`));
const validBefore = now + 3_600n;
const signature = await payer.signTypedData(
  buildReceiveAuth({ from: payer.address, to: router, value, validAfter: 0n, validBefore, nonce: payNonce(id, salt) }),
);
const client = createPublicClient({ chain: whitechainSepolia, transport: http(process.env.WHITECHAIN_RPC) });
const wbtBefore = await client.getBalance({ address: payer.address });

const res = await fetch(`${api}/relay/pay`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    invoiceId: id,
    value: amountArg,
    payer: payer.address,
    validAfter: "0",
    validBefore: validBefore.toString(),
    salt,
    signature,
  }),
});
const body = await res.json();
console.log(`HTTP ${res.status}`, JSON.stringify(body));
console.log(`paid ${formatUSDT(value)} | payer WBT before ${wbtBefore}, after ${await client.getBalance({ address: payer.address })} (must stay 0)`);
process.exit(res.ok ? 0 : 1);
