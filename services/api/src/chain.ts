import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { paymentRouterAbi, whitechainSepolia } from "@stenmont/shared";
import type { Env } from "./env";

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

type Base = { transactionHash: Hex; logIndex: number; blockNumber: bigint };
export type RouterLog =
  | (Base & { eventName: "InvoicePaid"; args: { id: Hex; payer: Address; value: bigint; paidTotal: bigint; fullyPaid: boolean } })
  | (Base & { eventName: "InvoiceRefunded"; args: { id: Hex; to: Address; value: bigint; refundedTotal: bigint } })
  | (Base & { eventName: "InvoiceCancelled"; args: { id: Hex } });

export interface ChainClient {
  /** Creates the invoice onchain through the router's delegation (the relayer is the merchant's creator). Resolves after the receipt. */
  createInvoice(req: CreateInvoiceRequest): Promise<{ txHash: Hex }>;
  getBlockNumber(): Promise<bigint>;
  getRouterLogs(fromBlock: bigint, toBlock: bigint): Promise<RouterLog[]>;
}

const WATCHED = ["InvoicePaid", "InvoiceRefunded", "InvoiceCancelled"] as const;

export function viemChain(env: Env): ChainClient {
  const transport = http(env.WHITECHAIN_RPC);
  const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
  const router = env.ROUTER_ADDRESS as Address;
  return {
    async createInvoice(req) {
      const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
      const wallet = createWalletClient({ account, chain: whitechainSepolia, transport });
      const { request } = await publicClient.simulateContract({
        account,
        address: router,
        abi: paymentRouterAbi,
        functionName: "createInvoiceAsCreator",
        args: [req],
      });
      const txHash = await wallet.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
      if (receipt.status !== "success") throw new Error(`createInvoice reverted in ${txHash}`);
      return { txHash };
    },
    getBlockNumber: () => publicClient.getBlockNumber(),
    async getRouterLogs(fromBlock, toBlock) {
      const logs = await publicClient.getContractEvents({
        address: router,
        abi: paymentRouterAbi,
        fromBlock,
        toBlock,
      });
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
  };
}
