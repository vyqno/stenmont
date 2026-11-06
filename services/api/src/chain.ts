import { BaseError, createPublicClient, decodeErrorResult, encodeFunctionData, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MULTICALL3_ADDRESS, USDT_ADDRESS, investorRegistryAbi, invoiceClaimAbi, multicall3Abi, passkeyAccountFactoryAbi, paymentRouterAbi, reputationRegistryAbi, subscriptionManagerAbi, usdtAbi, whitechainSepolia } from "@stenmont/shared";
import { windowStartBlock } from "./ens/agentSpend";
import type { Env } from "./env";
import type { Call } from "./relayer/sender";
import { verifyWalletSignature } from "./verification/siwe";

export type CreateInvoiceRequest = {
  merchant: Address;
  ref: Hex;
  payout: Address;
  payerLock: Address;
  amount: bigint;
  minPayment: bigint;
  dueDate: bigint;
  metaHash: Hex;
  deadline: bigint;
};

/** Creates a business's passkey account and authorises the relayer to create invoices for it, in one transaction. */
export type ActivateRequest = {
  account: Address;
  qx: Hex;
  qy: Hex;
  salt: Hex;
  creator: Address;
  deadline: bigint;
  /** The passkey's signature over the router's SetCreator digest (six WebAuthn fields, ABI-encoded flat). */
  signature: Hex;
};

/** The merchant account's signed token authorisation, redeemed by PaymentRouter.refund. */
export type RefundRequest = {
  invoiceId: Hex;
  value: bigint;
  to: Address;
  merchant: Address;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  signature: Hex;
  /** For refunds above the router's threshold: the attester's signature, sent with `refundWithApproval`. */
  approval?: { deadline: bigint; signature: Hex };
};

export type SubscriptionState = { nextCharge: bigint; charges: number; status: "none" | "active" | "cancelled" | "completed" };

type Base = { transactionHash: Hex; logIndex: number; blockNumber: bigint };
export type RouterLog =
  | (Base & { eventName: "InvoicePaid"; args: { id: Hex; payer: Address; value: bigint; paidTotal: bigint; fullyPaid: boolean } })
  | (Base & { eventName: "InvoiceRefunded"; args: { id: Hex; to: Address; value: bigint; refundedTotal: bigint } })
  | (Base & { eventName: "InvoiceCancelled"; args: { id: Hex } });

export type ListClaimRequest = { invoiceId: Hex; discountBps: number; reserveBps: number; deadline: bigint; termsSig: Hex; hookSig: Hex };
export type AllowInvestorRequest = { investor: Address; expiresAt: bigint; deadline: bigint; signature: Hex };
export const CLAIM_STATUSES = ["none", "listed", "funded", "settled", "defaulted", "cancelled"] as const;
export type ClaimState = { status: (typeof CLAIM_STATUSES)[number]; received: bigint; toHolder: bigint; fundBy: bigint };
/** A payer's onchain record (ReputationRegistry): invoices paid on time and late, volume in USDT base units, and the 0..100 score. */
export type ReputationRecord = { onTime: number; late: number; volume: bigint; score: number };
export type ClaimLog =
  | (Base & { eventName: "ClaimListed"; args: { invoiceId: Hex; merchant: Address; face: bigint; price: bigint; reserve: bigint; dueDate: bigint } })
  | (Base & { eventName: "ClaimFunded"; args: { invoiceId: Hex; investor: Address; price: bigint; advance: bigint } })
  | (Base & { eventName: "ClaimSettled"; args: { invoiceId: Hex; reserveReleased: bigint } })
  | (Base & { eventName: "ClaimDefaulted"; args: { invoiceId: Hex; holder: Address; reserveToHolder: bigint } })
  | (Base & { eventName: "ClaimCancelled"; args: { invoiceId: Hex } })
  | (Base & { eventName: "Transfer"; args: { from: Address; to: Address; tokenId: bigint } });

/** A call the contracts would reject. `reason` is the router error name when it can be decoded. */
export class Rejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export type Receipt = { status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint };

export interface ChainClient {
  /** Read-only invoice facts used before retiring an abandoned staging install. */
  invoiceState(id: Hex): Promise<{ status: number; paid: bigint; hook: Address }>;
  /** Creates the invoice onchain through the router's delegation (the relayer is the merchant's creator). Resolves after the receipt. */
  createInvoice(req: CreateInvoiceRequest): Promise<{ txHash: Hex }>;
  /** Deploys the passkey account and registers the relayer as its invoice creator (Multicall3). Resolves after the receipt. */
  activateMerchant(req: ActivateRequest): Promise<{ txHash: Hex }>;
  /** Sends PaymentRouter.refund with the merchant's signed authorisation. Throws Rejected if the contract would revert. Resolves after the receipt. */
  refund(req: RefundRequest): Promise<{ txHash: Hex }>;
  /** The subscription as the contract sees it (the source of truth for schedule and status). */
  subscriptionState(id: Hex): Promise<SubscriptionState>;
  /** The relayer wallet: the address merchants authorise to create invoices for them. */
  relayerAddress(): Address;
  /** Offers an invoice for sale (InvoiceClaim.list with the merchant's two signatures). Throws Rejected if the contracts would revert. Resolves after the receipt. */
  listClaim(req: ListClaimRequest): Promise<{ txHash: Hex }>;
  /** Puts an investor on the allowlist (InvestorRegistry.allow with the attester's signature). Throws Rejected. Resolves after the receipt. */
  allowInvestor(req: AllowInvestorRequest): Promise<{ txHash: Hex }>;
  /** The claim as the contract sees it (the source of truth). */
  claimState(invoiceId: Hex): Promise<ClaimState>;
  reputationOf(address: Address): Promise<ReputationRecord>;
  investorAllowed(address: Address): Promise<boolean>;
  /** The investor's attestation counter: the next `allow` signature must use it. */
  investorNonce(address: Address): Promise<bigint>;
  getClaimLogs(fromBlock: bigint, toBlock: bigint): Promise<ClaimLog[]>;
  getBlockNumber(): Promise<bigint>;
  getRouterLogs(fromBlock: bigint, toBlock: bigint): Promise<RouterLog[]>;
  /** Did this address sign this message (EIP-191)? Ordinary wallets by recovery; smart accounts through ERC-1271 on this chain. */
  verifyWalletSignature(req: { address: Address; message: string; signature: Hex }): Promise<boolean>;
  // relayer
  hasCode(address: Address): Promise<boolean>;
  passkeyAddress(qx: Hex, qy: Hex, salt: Hex): Promise<Address>;
  usdtBalance(address: Address): Promise<bigint>;
  /** EIP-2612 nonce of the token for this owner (the next permit must use it). */
  usdtNonce(address: Address): Promise<bigint>;
  usdtAllowance(owner: Address, spender: Address): Promise<bigint>;
  /** Total USDT the address sent (Transfer events with it as `from`) in about the last `seconds`. Read-only. */
  usdtSentSince(from: Address, seconds: number): Promise<bigint>;
  /** Gas the call would use. Throws Rejected if the contracts would revert it. */
  estimateGas(call: Call): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  relayerBalance(): Promise<bigint>;
  /** Hands the transaction to the single Durable Object sender; resolves with the hash, not the receipt. */
  sendTransaction(call: Call): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<Receipt>;
  /** Read-only confirmed receipt lookup; null means pending/not found. Never broadcasts. */
  lookupReceipt?(hash: Hex): Promise<Receipt | null>;
}

const errorString = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }] as const;

/** The router's error name, the token's revert string, or a generic marker. */
function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const holder = e.walk((x) => typeof (x as { data?: unknown }).data === "string" && (x as { data: string }).data.startsWith("0x"));
    const data = (holder as { data?: Hex } | null)?.data;
    if (data) {
      for (const abi of [paymentRouterAbi, invoiceClaimAbi, investorRegistryAbi]) {
        try {
          return decodeErrorResult({ abi, data }).errorName;
        } catch {
          /* not this contract's error */
        }
      }
      try {
        return String(decodeErrorResult({ abi: errorString, data }).args![0]);
      } catch {
        /* not Error(string) */
      }
    }
    return e.shortMessage || "reverted";
  }
  return "reverted";
}

/** How far back to measure the block time, and the most blocks a spend lookup will scan. */
const SPEND_SAMPLE_BLOCKS = 1_000n;
const SPEND_MAX_BLOCKS = 200_000n;

const WATCHED = ["InvoicePaid", "InvoiceRefunded", "InvoiceCancelled"] as const;
const CLAIM_WATCHED = ["ClaimListed", "ClaimFunded", "ClaimSettled", "ClaimDefaulted", "ClaimCancelled", "Transfer"] as const;

export function viemChain(env: Env): ChainClient {
  const transport = http(env.WHITECHAIN_RPC);
  const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
  const router = env.ROUTER_ADDRESS as Address;
  const relayer = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex).address;
  const sender = () => env.RELAYER.get(env.RELAYER.idFromName("main"));

  const estimate = async (call: Call) => {
    try {
      return await publicClient.estimateGas({ account: relayer, to: call.to, data: call.data });
    } catch (e) {
      throw new Rejected(revertReason(e));
    }
  };
  const wait = async (hash: Hex): Promise<Receipt> => {
    const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 45_000 });
    return { status: r.status, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice };
  };

  return {
    async invoiceState(id) {
      const state = await publicClient.readContract({ address: router, abi: paymentRouterAbi, functionName: "invoices", args: [id] });
      return { status: state.status, paid: state.paid, hook: state.hook };
    },
    async createInvoice(req) {
      const call = { to: router, data: encodeFunctionData({ abi: paymentRouterAbi, functionName: "createInvoiceAsCreator", args: [req] }) };
      await estimate(call); // refuse early, before spending gas on a transaction that would revert
      const txHash = await sender().submit(call);
      const receipt = await wait(txHash);
      if (receipt.status !== "success") throw new Error(`createInvoice reverted in ${txHash}`);
      return { txHash };
    },
    relayerAddress: () => relayer,
    async subscriptionState(id) {
      const [, st] = await publicClient.readContract({
        address: env.SUBSCRIPTION_MANAGER_ADDRESS as Address,
        abi: subscriptionManagerAbi,
        functionName: "subscription",
        args: [id],
      });
      return { nextCharge: st.nextCharge, charges: st.charges, status: (["none", "active", "cancelled", "completed"] as const)[st.status]! };
    },
    async refund(req) {
      const call = {
        to: router,
        data: encodeFunctionData({
          abi: paymentRouterAbi,
          ...(req.approval
            ? {
                functionName: "refundWithApproval" as const,
                args: [req.invoiceId, req.value, req.to, { payer: req.merchant, validAfter: req.validAfter, validBefore: req.validBefore, salt: req.salt, signature: req.signature }, req.approval] as const,
              }
            : {
                functionName: "refund" as const,
                args: [req.invoiceId, req.value, req.to, { payer: req.merchant, validAfter: req.validAfter, validBefore: req.validBefore, salt: req.salt, signature: req.signature }] as const,
              }),
        }),
      };
      await estimate(call);
      const txHash = await sender().submit(call);
      const receipt = await wait(txHash);
      if (receipt.status !== "success") throw new Error(`refund reverted in ${txHash}`);
      return { txHash };
    },
    async activateMerchant(req) {
      const createData = encodeFunctionData({ abi: passkeyAccountFactoryAbi, functionName: "createAccount", args: [req.qx, req.qy, req.salt] });
      const delegateData = encodeFunctionData({
        abi: paymentRouterAbi,
        functionName: "setCreator",
        args: [req.account, req.creator, true, req.deadline, req.signature],
      });
      const call = {
        to: MULTICALL3_ADDRESS,
        data: encodeFunctionData({
          abi: multicall3Abi,
          functionName: "aggregate3",
          args: [[{ target: env.FACTORY_ADDRESS as Address, allowFailure: false, callData: createData }, { target: router, allowFailure: false, callData: delegateData }]],
        }),
      };
      await estimate(call);
      const txHash = await sender().submit(call);
      const receipt = await wait(txHash);
      if (receipt.status !== "success") throw new Error(`activateMerchant reverted in ${txHash}`);
      return { txHash };
    },
    async listClaim(req) {
      const call = {
        to: env.INVOICE_CLAIM_ADDRESS as Address,
        data: encodeFunctionData({ abi: invoiceClaimAbi, functionName: "list", args: [req.invoiceId, req.discountBps, req.reserveBps, req.deadline, req.termsSig, req.hookSig] }),
      };
      await estimate(call);
      const txHash = await sender().submit(call);
      const receipt = await wait(txHash);
      if (receipt.status !== "success") throw new Error(`listClaim reverted in ${txHash}`);
      return { txHash };
    },
    async allowInvestor(req) {
      const call = {
        to: env.INVESTOR_REGISTRY_ADDRESS as Address,
        data: encodeFunctionData({ abi: investorRegistryAbi, functionName: "allow", args: [req.investor, req.expiresAt, req.deadline, req.signature] }),
      };
      await estimate(call);
      const txHash = await sender().submit(call);
      const receipt = await wait(txHash);
      if (receipt.status !== "success") throw new Error(`allowInvestor reverted in ${txHash}`);
      return { txHash };
    },
    async claimState(invoiceId) {
      const c = await publicClient.readContract({ address: env.INVOICE_CLAIM_ADDRESS as Address, abi: invoiceClaimAbi, functionName: "claims", args: [invoiceId] });
      return { status: CLAIM_STATUSES[c.status] ?? "none", received: c.received, toHolder: c.toHolder, fundBy: BigInt(c.fundBy) };
    },
    async reputationOf(address) {
      const reputation = env.REPUTATION_REGISTRY_ADDRESS as Address;
      const [r, score] = await Promise.all([
        publicClient.readContract({ address: reputation, abi: reputationRegistryAbi, functionName: "recordOf", args: [address] }),
        publicClient.readContract({ address: reputation, abi: reputationRegistryAbi, functionName: "score", args: [address] }),
      ]);
      return { onTime: r.onTime, late: r.late, volume: r.volume, score: Number(score) };
    },
    investorAllowed: (address) => publicClient.readContract({ address: env.INVESTOR_REGISTRY_ADDRESS as Address, abi: investorRegistryAbi, functionName: "isAllowed", args: [address] }),
    investorNonce: (address) => publicClient.readContract({ address: env.INVESTOR_REGISTRY_ADDRESS as Address, abi: investorRegistryAbi, functionName: "nonces", args: [address] }),
    async getClaimLogs(fromBlock, toBlock) {
      const logs = await publicClient.getContractEvents({ address: env.INVOICE_CLAIM_ADDRESS as Address, abi: invoiceClaimAbi, fromBlock, toBlock });
      return logs
        .filter((l) => (CLAIM_WATCHED as readonly string[]).includes(l.eventName as string))
        .map((l) => ({ eventName: l.eventName, args: l.args, transactionHash: l.transactionHash, logIndex: l.logIndex, blockNumber: l.blockNumber })) as ClaimLog[];
    },
    getBlockNumber: () => publicClient.getBlockNumber(),
    async getRouterLogs(fromBlock, toBlock) {
      const logs = await publicClient.getContractEvents({ address: router, abi: paymentRouterAbi, fromBlock, toBlock });
      return logs
        .filter((l) => (WATCHED as readonly string[]).includes(l.eventName as string))
        .map((l) => ({
          eventName: l.eventName,
          args: l.args,
          transactionHash: l.transactionHash,
          logIndex: l.logIndex,
          blockNumber: l.blockNumber,
        })) as RouterLog[];
    },
    async hasCode(address) {
      const code = await publicClient.getCode({ address });
      return !!code && code !== "0x";
    },
    verifyWalletSignature: (req) =>
      verifyWalletSignature(
        {
          getCode: (address) => publicClient.getCode({ address }),
          isValidSignature: (address, hash, signature) =>
            publicClient.readContract({ address, abi: [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bytes4" }] }] as const, functionName: "isValidSignature", args: [hash, signature] }),
        },
        req,
      ),
    passkeyAddress: (qx, qy, salt) =>
      publicClient.readContract({ address: env.FACTORY_ADDRESS as Address, abi: passkeyAccountFactoryAbi, functionName: "getAddress", args: [qx, qy, salt] }),
    usdtNonce: (address) => publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "nonces", args: [address] }),
    usdtAllowance: (owner, spender) => publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "allowance", args: [owner, spender] }),
    async usdtSentSince(from, seconds) {
      const latest = await publicClient.getBlock();
      const sampleNumber = latest.number > SPEND_SAMPLE_BLOCKS ? latest.number - SPEND_SAMPLE_BLOCKS : 0n;
      const sample = sampleNumber === latest.number ? latest : await publicClient.getBlock({ blockNumber: sampleNumber });
      const fromBlock = windowStartBlock({ latest: { number: latest.number, timestamp: latest.timestamp }, sample: { number: sample.number, timestamp: sample.timestamp }, windowSeconds: seconds, maxBlocks: SPEND_MAX_BLOCKS });
      const logs = await publicClient.getContractEvents({ address: USDT_ADDRESS, abi: usdtAbi, eventName: "Transfer", args: { from }, fromBlock, toBlock: latest.number });
      return logs.reduce((sum, l) => sum + l.args.value!, 0n);
    },
    usdtBalance: (address) => publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [address] }),
    estimateGas: estimate,
    gasPrice: () => publicClient.getGasPrice(),
    relayerBalance: () => publicClient.getBalance({ address: relayer }),
    sendTransaction: (call) => sender().submit(call),
    waitForReceipt: wait,
    async lookupReceipt(hash) {
      const reader=createPublicClient({chain:whitechainSepolia,transport:http(env.WHITECHAIN_RPC,{timeout:5000,retryCount:0})});
      try {
        const receipt=await reader.getTransactionReceipt({hash});
        const head=await reader.getBlockNumber();
        if(head-receipt.blockNumber+1n<BigInt(Math.max(1,Number(env.INDEXER_CONFIRMATIONS??2))))return null;
        return {status:receipt.status,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice};
      } catch(error) {
        if(error instanceof Error && error.name==="TransactionReceiptNotFoundError")return null;
        throw error;
      }
    },
  };
}
