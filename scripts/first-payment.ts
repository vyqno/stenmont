// Task 2.3: one real invoice paid in the official USDT on Whitechain Sepolia (staging deployment).
//   merchant (deployer wallet) signs the invoice, demo payer signs a USDT authorization, relayer pays the gas.
//   pnpm --filter @stenmont/scripts first-payment
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  zeroAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  USDT_ADDRESS,
  buildReceiveAuth,
  createInvoiceTypes,
  deployments,
  formatUSDT,
  invoiceId,
  invoiceRef,
  payNonce,
  paymentRouterAbi,
  routerDomain,
  toUnits,
  whitechainSepolia,
} from "@stenmont/shared";

const need = (k: string): Hex => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k} in .env`);
  return v as Hex;
};
const usdtAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const router = deployments.environments.staging.PaymentRouter.address;
const merchant = privateKeyToAccount(need("STENMONT_DEPLOYER_PRIVATE_KEY"));
const payer = privateKeyToAccount(need("STENMONT_DEMO_PAYER_PRIVATE_KEY"));
const relayer = privateKeyToAccount(need("STENMONT_RELAYER_PRIVATE_KEY"));

const transport = http(process.env.WHITECHAIN_RPC ?? whitechainSepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
const relayerClient = createWalletClient({ account: relayer, chain: whitechainSepolia, transport });
const explorer = (hash: Hex) => `${whitechainSepolia.blockExplorers.default.url}/tx/${hash}`;
const balance = (a: Hex) => publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [a] });

const now = BigInt(Math.floor(Date.now() / 1000));
const amount = toUnits("1.00");
const number = `INV-${now}`;
const id = invoiceId(merchant.address, number);

console.log(`router ${router}\ninvoice ${number}\nid ${id}`);
const before = { merchant: await balance(merchant.address), payer: await balance(payer.address) };

// 1. merchant signs, relayer creates
const req = {
  merchant: merchant.address,
  ref: invoiceRef(number),
  payout: merchant.address,
  payerLock: zeroAddress,
  amount,
  minPayment: 0n,
  dueDate: now + 30n * 86_400n,
  metaHash: keccak256(toBytes(number)),
  deadline: now + 3_600n,
};
const merchantSig = await merchant.signTypedData({
  domain: routerDomain(router),
  types: createInvoiceTypes,
  primaryType: "CreateInvoice",
  message: req,
});
const createSim = await publicClient.simulateContract({
  account: relayer,
  address: router,
  abi: paymentRouterAbi,
  functionName: "createInvoice",
  args: [req, merchantSig],
});
const createHash = await relayerClient.writeContract(createSim.request);
await publicClient.waitForTransactionReceipt({ hash: createHash });
console.log(`created  ${explorer(createHash)}`);

// 2. payer signs a USDT authorization bound to this invoice, relayer pays the gas
const salt = keccak256(toBytes(`salt-${now}`));
const validBefore = now + 3_600n;
const auth = buildReceiveAuth({
  from: payer.address,
  to: router,
  value: amount,
  validAfter: 0n,
  validBefore,
  nonce: payNonce(id, salt),
});
const payerSig = await payer.signTypedData(auth);
const paySim = await publicClient.simulateContract({
  account: relayer,
  address: router,
  abi: paymentRouterAbi,
  functionName: "pay",
  args: [id, amount, { payer: payer.address, validAfter: 0n, validBefore, salt, signature: payerSig }],
});
const payHash = await relayerClient.writeContract(paySim.request);
await publicClient.waitForTransactionReceipt({ hash: payHash });
console.log(`paid     ${explorer(payHash)}`);

const after = { merchant: await balance(merchant.address), payer: await balance(payer.address) };
const wbt = await publicClient.getBalance({ address: payer.address });
console.log(
  `payer   ${formatUSDT(before.payer)} -> ${formatUSDT(after.payer)}   (WBT held by payer: ${wbt})`,
);
console.log(`merchant ${formatUSDT(before.merchant)} -> ${formatUSDT(after.merchant)}`);
const inv = await publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "invoices", args: [id] });
console.log(`invoice status ${inv.status} (2 = Paid), paid ${formatUSDT(inv.paid)}`);
