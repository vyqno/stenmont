// Pays an existing invoice with the demo payer: the payer signs a USDT authorization bound to the invoice, the
// relayer pays the gas.   pnpm --filter @stenmont/scripts pay-invoice <invoiceId> <amount>
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildReceiveAuth, deployments, formatUSDT, payNonce, paymentRouterAbi, toUnits, whitechainSepolia } from "@stenmont/shared";

const [id, amountArg] = process.argv.slice(2) as [Hex | undefined, string | undefined];
if (!id || !/^0x[0-9a-f]{64}$/.test(id) || !amountArg) throw new Error("usage: pay-invoice <invoiceId 0x…> <amount>");
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k} in .env`);
  return v as Hex;
};
const router = deployments.environments.staging.PaymentRouter.address;
const payer = privateKeyToAccount(need("STENMONT_DEMO_PAYER_PRIVATE_KEY"));
const relayer = privateKeyToAccount(need("STENMONT_RELAYER_PRIVATE_KEY"));
const transport = http(process.env.WHITECHAIN_RPC ?? whitechainSepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
const relayerClient = createWalletClient({ account: relayer, chain: whitechainSepolia, transport });

const value = toUnits(amountArg);
const now = BigInt(Math.floor(Date.now() / 1000));
const salt = keccak256(toBytes(`salt-${now}-${Math.random()}`));
const validBefore = now + 3_600n;
const signature = await payer.signTypedData(
  buildReceiveAuth({ from: payer.address, to: router, value, validAfter: 0n, validBefore, nonce: payNonce(id, salt) }),
);
const { request } = await publicClient.simulateContract({
  account: relayer,
  address: router,
  abi: paymentRouterAbi,
  functionName: "pay",
  args: [id, value, { payer: payer.address, validAfter: 0n, validBefore, salt, signature }],
});
const hash = await relayerClient.writeContract(request);
await publicClient.waitForTransactionReceipt({ hash });
console.log(`paid ${formatUSDT(value)}: ${whitechainSepolia.blockExplorers.default.url}/tx/${hash}`);
