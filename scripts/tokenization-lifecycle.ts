// Runs the whole invoice-financing (tokenization) lifecycle on STAGING (Whitechain Sepolia, chain 1874) with the test wallets in .env.
//   pnpm --filter @stenmont/scripts tokenization-lifecycle -- --dry-run      print the plan, send nothing, read no keys
//   pnpm --filter @stenmont/scripts tokenization-lifecycle                   run it for real (needs test USDT and a little WBT)
//   pnpm --filter @stenmont/scripts tokenization-lifecycle -- --default-path describe the default path (not run: 7-day grace)
// Flags: --face 1 --discount-bps 500 --reserve-bps 1000 --due-hours 24 --api https://api-staging.stenmont.com
// Keys are read from .env and never printed. This talks to the contracts directly; it is not the merchant dashboard flow.
import { parseArgs } from "node:util";
import { createPublicClient, createWalletClient, erc20Abi, http, keccak256, toBytes, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  allowInvestorTypes, buildReceiveAuth, claimDomain, claimTermsTypes, deployments, fundNonce, investorRegistryAbi, investorRegistryDomain, invoiceClaimAbi,
  invoiceId as invoiceIdOf, invoiceRef, payNonce, paymentRouterAbi, reputationRegistryAbi, routerDomain, setCreatorTypes, setHookTypes, USDT_ADDRESS, whitechainSepolia, formatUSDT,
} from "@stenmont/shared";
import {
  STAGING_CHAIN_ID, assertStaging, checkOutcome, defaultPathNotes, explorerAddress, explorerToken, explorerTx, lifecycleMath, planLines, resolveOptions, summaryTable, type Balances, type Row,
} from "./tokenization-lifecycle-lib";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" }, "default-path": { type: "boolean" }, help: { type: "boolean" },
    face: { type: "string" }, "discount-bps": { type: "string" }, "reserve-bps": { type: "string" }, "due-hours": { type: "string" }, api: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let o;
try {
  o = resolveOptions(values);
} catch (e) {
  fail((e as Error).message);
}
if (o.help) {
  console.log("Flags: --dry-run  --default-path  --face <usdt>  --discount-bps <n>  --reserve-bps <n>  --due-hours <n>  --api <staging url>");
  process.exit(0);
}
if (o.defaultPath) {
  console.log(defaultPathNotes().join("\n"));
  process.exit(0);
}

// Guard 1 (static, before anything else): the configured chain and API. Guard 2 (live runs): the chain id the RPC really reports.
const configuredChain = Number(process.env.WHITECHAIN_CHAIN_ID ?? STAGING_CHAIN_ID);
let apiUrl: URL;
try {
  apiUrl = assertStaging({ chainId: configuredChain, apiUrl: o.apiUrl });
} catch (e) {
  fail((e as Error).message);
}
const math = lifecycleMath(o);
console.log(planLines(o, math).join("\n"));
if (o.dryRun) process.exit(0);

// ---------------------------------------------------------------------------------------------------------------- live run
const need = (k: string) => {
  const v = process.env[k];
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) fail(`missing or malformed ${k} in .env`);
  return v as Hex;
};
const staging = deployments.environments.staging;
const router = staging.PaymentRouter.address as Address;
const claim = staging.InvoiceClaim.address as Address;
const registry = staging.InvestorRegistry.address as Address;
const reputation = staging.PaymentRouter.reputation as Address;

const relayer = privateKeyToAccount(need("STENMONT_RELAYER_PRIVATE_KEY"));
const attester = privateKeyToAccount(need("STENMONT_ATTESTER_PRIVATE_KEY"));
const investor = privateKeyToAccount(need("STENMONT_DEPLOYER_PRIVATE_KEY"));
const buyer = privateKeyToAccount(need("STENMONT_DEMO_PAYER_PRIVATE_KEY"));
const merchant = privateKeyToAccount(generatePrivateKey()); // signs only, never funded, never printed
const payout = attester.address; // the merchant's payout wallet: a neutral test wallet we hold

const transport = http(process.env.WHITECHAIN_RPC ?? whitechainSepolia.rpcUrls.default.http[0]);
const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
const relayerClient = createWalletClient({ account: relayer, chain: whitechainSepolia, transport });

const reportedChain = await publicClient.getChainId();
try {
  assertStaging({ chainId: reportedChain, apiUrl: o.apiUrl });
} catch (e) {
  fail((e as Error).message);
}

const rows: Row[] = [];
const link = (hash: string) => explorerTx(hash);
const usdt = (a: Address) => publicClient.readContract({ address: USDT_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const balances = async (): Promise<Balances> => ({ investor: await usdt(investor.address), payout: await usdt(payout), buyer: await usdt(buyer.address), claim: await usdt(claim), router: await usdt(router) });
const step = (n: string) => console.log(`\n== ${n}`);

async function send(label: string, actor: string, request: Parameters<typeof relayerClient.writeContract>[0]) {
  const hash = await relayerClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") fail(`${label} reverted: ${link(hash)}`);
  console.log(`${label}: ${link(hash)}`);
  rows.push({ step: label, actor, result: "ok", url: link(hash) });
  return hash;
}

// Preflight: everything that would make a step fail halfway, checked before the first transaction.
step("Preflight");
const [attesterOnChain, routerReputation, relayerWbt, before] = await Promise.all([
  publicClient.readContract({ address: registry, abi: investorRegistryAbi, functionName: "attester" }),
  publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "reputation" }),
  publicClient.getBalance({ address: relayer.address }),
  balances(),
]);
if (attesterOnChain.toLowerCase() !== attester.address.toLowerCase()) fail("The attester key in .env is not the attester of the staging InvestorRegistry.");
if (routerReputation.toLowerCase() !== reputation.toLowerCase()) fail("The staging router is not wired to the staging ReputationRegistry.");
if (relayerWbt < 20_000_000_000_000_000n) fail("The relayer wallet has less than 0.02 WBT for gas.");
if (before.investor < math.price) fail(`The investor test wallet needs ${formatUSDT(math.price)} USDT, it has ${formatUSDT(before.investor)}.`);
if (before.buyer < math.face) fail(`The buyer test wallet needs ${formatUSDT(math.face)} USDT, it has ${formatUSDT(before.buyer)}.`);
console.log(`merchant (throwaway) ${merchant.address}, payout ${explorerAddress(payout)}, investor ${investor.address}, buyer ${buyer.address}`);
console.log(`USDT before: investor ${formatUSDT(before.investor)}, payout ${formatUSDT(before.payout)}, buyer ${formatUSDT(before.buyer)}`);

const blockNow = (await publicClient.getBlock()).timestamp;
const deadline = blockNow + 6n * 3_600n; // the signatures and the listing stay valid for 6 hours
const dueDate = blockNow + BigInt(o.dueHours) * 3_600n;
const number = `LIFECYCLE-${blockNow}`;
const ref = invoiceRef(number);
const id = invoiceIdOf(merchant.address, number);

// 1. delegation: the merchant lets the relayer create invoices for it
step("1. Delegate invoice creation (merchant signs, relayer sends)");
const creatorNonce = await publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "creatorNonce", args: [merchant.address] });
const creatorSig = await merchant.signTypedData({
  domain: routerDomain(router), types: setCreatorTypes, primaryType: "SetCreator",
  message: { merchant: merchant.address, creator: relayer.address, allowed: true, deadline, nonce: creatorNonce },
});
await send("1 setCreator", "relayer", (await publicClient.simulateContract({ account: relayer, address: router, abi: paymentRouterAbi, functionName: "setCreator", args: [merchant.address, relayer.address, true, deadline, creatorSig] })).request);

// 2. the invoice
step("2. Create the invoice (relayer, as the merchant's delegated creator)");
const metaHash = keccak256(toBytes("stenmont-tokenization-lifecycle"));
const invoiceArgs = { merchant: merchant.address, ref, payout, payerLock: "0x0000000000000000000000000000000000000000" as Address, amount: math.face, minPayment: math.face, dueDate, metaHash, deadline } as const;
await send("2 createInvoiceAsCreator", "relayer", (await publicClient.simulateContract({ account: relayer, address: router, abi: paymentRouterAbi, functionName: "createInvoiceAsCreator", args: [invoiceArgs] })).request);
console.log(`invoice ${id}`);

// 3. offer it for sale: two merchant signatures (claim terms, router hook)
step("3. List the invoice for financing (merchant signs twice, relayer sends)");
const termsSig = await merchant.signTypedData({
  domain: claimDomain(claim), types: claimTermsTypes, primaryType: "ClaimTerms",
  message: { invoiceId: id, discountBps: o.discountBps, reserveBps: o.reserveBps, deadline },
});
const hookSig = await merchant.signTypedData({
  domain: routerDomain(router), types: setHookTypes, primaryType: "SetHook", message: { id, hook: claim, deadline },
});
await send("3 list", "relayer", (await publicClient.simulateContract({ account: relayer, address: claim, abi: invoiceClaimAbi, functionName: "list", args: [id, o.discountBps, o.reserveBps, deadline, termsSig, hookSig] })).request);

// 4. allow the test investor (bypasses World)
step("4. Allow the test investor");
console.log("WARNING: TEST SHORTCUT. The attester key signs the allowlist entry directly. The real flow requires a World proof (POST /invest/allow); this skips it.");
const alreadyAllowed = await publicClient.readContract({ address: registry, abi: investorRegistryAbi, functionName: "isAllowed", args: [investor.address] });
if (alreadyAllowed) {
  console.log("The investor wallet is already on the allowlist; nothing to send.");
  rows.push({ step: "4 allow", actor: "attester (test shortcut)", result: "already allowed" });
} else {
  const nonce = await publicClient.readContract({ address: registry, abi: investorRegistryAbi, functionName: "nonces", args: [investor.address] });
  const expiresAt = blockNow + 24n * 3_600n;
  const attestation = await attester.signTypedData({
    domain: investorRegistryDomain(registry), types: allowInvestorTypes, primaryType: "AllowInvestor",
    message: { investor: investor.address, expiresAt, deadline, nonce },
  });
  await send("4 allow", "attester (test shortcut)", (await publicClient.simulateContract({ account: relayer, address: registry, abi: investorRegistryAbi, functionName: "allow", args: [investor.address, expiresAt, deadline, attestation] })).request);
}

// 5. the investor buys the claim
step("5. The investor funds the claim");
const fundSalt = keccak256(toBytes(`fund-${id}-${blockNow}`));
const fundSig = await investor.signTypedData(buildReceiveAuth({ from: investor.address, to: claim, value: math.price, validAfter: 0n, validBefore: deadline, nonce: fundNonce(id, fundSalt) }));
await send("5 fund", "relayer", (await publicClient.simulateContract({
  account: relayer, address: claim, abi: invoiceClaimAbi, functionName: "fund",
  args: [id, { payer: investor.address, validAfter: 0n, validBefore: deadline, salt: fundSalt, signature: fundSig }],
})).request);
const holder = await publicClient.readContract({ address: claim, abi: invoiceClaimAbi, functionName: "ownerOf", args: [BigInt(id)] });
console.log(`claim token ${BigInt(id)} is held by ${holder}${holder.toLowerCase() === investor.address.toLowerCase() ? " (the investor)" : " (UNEXPECTED)"}`);

// 6. the buyer pays the invoice
step("6. The buyer pays the invoice");
const record = (a: Address) => publicClient.readContract({ address: reputation, abi: reputationRegistryAbi, functionName: "recordOf", args: [a] });
const recordBefore = await record(buyer.address);
const paySalt = keccak256(toBytes(`pay-${id}-${blockNow}`));
const paySig = await buyer.signTypedData(buildReceiveAuth({ from: buyer.address, to: router, value: math.face, validAfter: 0n, validBefore: deadline, nonce: payNonce(id, paySalt) }));
const payHash = await send("6 pay", "relayer", (await publicClient.simulateContract({
  account: relayer, address: router, abi: paymentRouterAbi, functionName: "pay",
  args: [id, math.face, { payer: buyer.address, validAfter: 0n, validBefore: deadline, salt: paySalt, signature: paySig }],
})).request);

// 7. confirm
step("7. Confirm settlement");
const state = await publicClient.readContract({ address: claim, abi: invoiceClaimAbi, functionName: "claims", args: [id] });
const STATUS = ["None", "Listed", "Funded", "Settled", "Defaulted", "Cancelled"];
const status = STATUS[state.status] ?? String(state.status);
console.log(`claim status on chain: ${status}; received ${formatUSDT(state.received)}, paid to holder ${formatUSDT(state.toHolder)}`);
const after = await balances();
const outcome = checkOutcome(before, after, math);
console.log(`USDT after: investor ${formatUSDT(after.investor)}, payout ${formatUSDT(after.payout)}, buyer ${formatUSDT(after.buyer)}; claim contract ${formatUSDT(after.claim)}, router ${formatUSDT(after.router)}`);
const recordAfter = await record(buyer.address);
console.log(`buyer's payment record: ${recordBefore.onTime} on time / ${recordBefore.late} late before, ${recordAfter.onTime} / ${recordAfter.late} after`);
rows.push({ step: "7 confirm", actor: "chain", result: `${status}; balances ${outcome.ok ? "as expected" : "OFF"}`, url: link(payHash) });

// The staging API only knows claims listed through a merchant account in the dashboard; ask it anyway and say what it answers.
step("Staging API");
try {
  const health = await fetch(new URL("/health", apiUrl), { signal: AbortSignal.timeout(10_000) });
  console.log(`GET /health: ${health.status}`);
  const cert = await fetch(new URL(`/public/claims/${id}`, apiUrl), { signal: AbortSignal.timeout(10_000) });
  console.log(cert.status === 404
    ? "GET /public/claims/<id>: 404. Expected: this run used the contracts directly, so the API has no merchant account for this claim. List an invoice from the dashboard (Sell this invoice) to see the certificate page and the timeline."
    : `GET /public/claims/<id>: ${cert.status}`);
} catch (e) {
  console.log(`The staging API could not be reached (${(e as Error).message}); the chain result above stands on its own.`);
}

console.log(`\n${summaryTable(rows)}`);
console.log(`\nclaim contract ${explorerAddress(claim)}\nclaim token    ${explorerToken(claim, BigInt(id))}`);
for (const p of outcome.problems) console.error(`CHECK FAILED: ${p}`);
if (status !== "Settled" || !outcome.ok) fail("The lifecycle did not end as expected.");
console.log("\nDone: invoice listed, investor allowed and funded, buyer paid, claim settled. The default path is documented with --default-path.");
