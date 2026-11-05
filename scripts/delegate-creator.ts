// The merchant signs once that the relayer may create invoices for them; the relayer submits it.
// After this the API never needs the merchant's key. Staging router by default.
//   pnpm --filter @stenmont/scripts delegate-creator
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deployments, paymentRouterAbi, routerDomain, setCreatorTypes, whitechainSepolia } from "@stenmont/shared";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k} in .env`);
  return v as Hex;
};
const router = deployments.environments.staging.PaymentRouter.address;
const merchant = privateKeyToAccount(need("STENMONT_DEPLOYER_PRIVATE_KEY"));
const relayer = privateKeyToAccount(need("STENMONT_RELAYER_PRIVATE_KEY"));
const transport = http(process.env.WHITECHAIN_RPC ?? whitechainSepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
const relayerClient = createWalletClient({ account: relayer, chain: whitechainSepolia, transport });

const already = await publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "creators", args: [merchant.address, relayer.address] });
if (already) {
  console.log("relayer is already a creator for this merchant");
  process.exit(0);
}
const nonce = await publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "creatorNonce", args: [merchant.address] });
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const signature = await merchant.signTypedData({
  domain: routerDomain(router),
  types: setCreatorTypes,
  primaryType: "SetCreator",
  message: { merchant: merchant.address, creator: relayer.address, allowed: true, deadline, nonce },
});
const { request } = await publicClient.simulateContract({
  account: relayer,
  address: router,
  abi: paymentRouterAbi,
  functionName: "setCreator",
  args: [merchant.address, relayer.address, true, deadline, signature],
});
const hash = await relayerClient.writeContract(request);
await publicClient.waitForTransactionReceipt({ hash });
console.log(`delegated: ${whitechainSepolia.blockExplorers.default.url}/tx/${hash}`);
