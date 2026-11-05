import { BaseError, createPublicClient, decodeErrorResult, encodeFunctionData, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MULTICALL3_ADDRESS, USDT_ADDRESS, multicall3Abi, passkeyAccountFactoryAbi, paymentRouterAbi, usdtAbi, whitechainSepolia } from "@stenmont/shared";
import type { Env } from "./env";
import type { Call } from "./relayer/sender";

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
};

type Base = { transactionHash: Hex; logIndex: number; blockNumber: bigint };
export type RouterLog =
  | (Base & { eventName: "InvoicePaid"; args: { id: Hex; payer: Address; value: bigint; paidTotal: bigint; fullyPaid: boolean } })
  | (Base & { eventName: "InvoiceRefunded"; args: { id: Hex; to: Address; value: bigint; refundedTotal: bigint } })
  | (Base & { eventName: "InvoiceCancelled"; args: { id: Hex } });

/** A call the contracts would reject. `reason` is the router error name when it can be decoded. */
export class Rejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export type Receipt = { status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint };

export interface ChainClient {
  /** Creates the invoice onchain through the router's delegation (the relayer is the merchant's creator). Resolves after the receipt. */
  createInvoice(req: CreateInvoiceRequest): Promise<{ txHash: Hex }>;
  /** Deploys the passkey account and registers the relayer as its invoice creator (Multicall3). Resolves after the receipt. */
  activateMerchant(req: ActivateRequest): Promise<{ txHash: Hex }>;
  /** Sends PaymentRouter.refund with the merchant's signed authorisation. Throws Rejected if the contract would revert. Resolves after the receipt. */
  refund(req: RefundRequest): Promise<{ txHash: Hex }>;
  /** The relayer wallet: the address merchants authorise to create invoices for them. */
  relayerAddress(): Address;
  getBlockNumber(): Promise<bigint>;
  getRouterLogs(fromBlock: bigint, toBlock: bigint): Promise<RouterLog[]>;
  // relayer
  hasCode(address: Address): Promise<boolean>;
  passkeyAddress(qx: Hex, qy: Hex, salt: Hex): Promise<Address>;
  usdtBalance(address: Address): Promise<bigint>;
  /** Gas the call would use. Throws Rejected if the contracts would revert it. */
  estimateGas(call: Call): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  relayerBalance(): Promise<bigint>;
  /** Hands the transaction to the single Durable Object sender; resolves with the hash, not the receipt. */
  sendTransaction(call: Call): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<Receipt>;
}

const errorString = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }] as const;

/** The router's error name, the token's revert string, or a generic marker. */
function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const holder = e.walk((x) => typeof (x as { data?: unknown }).data === "string" && (x as { data: string }).data.startsWith("0x"));
    const data = (holder as { data?: Hex } | null)?.data;
    if (data) {
      try {
        return decodeErrorResult({ abi: paymentRouterAbi, data }).errorName;
      } catch {
        /* not a router error */
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

const WATCHED = ["InvoicePaid", "InvoiceRefunded", "InvoiceCancelled"] as const;

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
    async createInvoice(req) {
      const call = { to: router, data: encodeFunctionData({ abi: paymentRouterAbi, functionName: "createInvoiceAsCreator", args: [req] }) };
      await estimate(call); // refuse early, before spending gas on a transaction that would revert
      const txHash = await sender().submit(call);
      const receipt = await wait(txHash);
      if (receipt.status !== "success") throw new Error(`createInvoice reverted in ${txHash}`);
      return { txHash };
    },
    relayerAddress: () => relayer,
    async refund(req) {
      const call = {
        to: router,
        data: encodeFunctionData({
          abi: paymentRouterAbi,
          functionName: "refund",
          args: [req.invoiceId, req.value, req.to, { payer: req.merchant, validAfter: req.validAfter, validBefore: req.validBefore, salt: req.salt, signature: req.signature }],
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
    passkeyAddress: (qx, qy, salt) =>
      publicClient.readContract({ address: env.FACTORY_ADDRESS as Address, abi: passkeyAccountFactoryAbi, functionName: "getAddress", args: [qx, qy, salt] }),
    usdtBalance: (address) => publicClient.readContract({ address: USDT_ADDRESS, abi: usdtAbi, functionName: "balanceOf", args: [address] }),
    estimateGas: estimate,
    gasPrice: () => publicClient.getGasPrice(),
    relayerBalance: () => publicClient.getBalance({ address: relayer }),
    sendTransaction: (call) => sender().submit(call),
    waitForReceipt: wait,
  };
}
