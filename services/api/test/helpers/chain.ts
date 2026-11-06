import { Rejected, type ActivateRequest, type ChainClient, type RefundRequest } from "../../src/chain";
import type { Call } from "../../src/relayer/sender";

export const RELAYER_ADDRESS = "0xe4F5853650f40f04e920c62F6dE9e4e38D767B66" as const;
export const PASSKEY_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

/** Fake chain: records everything it is asked to do and serves canned answers. */
export function fakeChain(overrides: Partial<ChainClient> = {}) {
  const calls: unknown[] = [];
  const sent: Call[] = [];
  const activations: ActivateRequest[] = [];
  const refundsSent: RefundRequest[] = [];
  const counts = { estimate: 0 };
  const chain: ChainClient & { calls: unknown[]; sent: Call[]; activations: ActivateRequest[]; refundsSent: RefundRequest[]; counts: typeof counts } = {
    calls,
    sent,
    activations,
    refundsSent,
    counts,
    relayerAddress() {
      return RELAYER_ADDRESS;
    },
    async activateMerchant(req) {
      activations.push(req);
      return { txHash: hash(5000 + activations.length) };
    },
    async subscriptionState() {
      return { nextCharge: 0n, charges: 0, status: "active" as const };
    },
    async refund(req) {
      refundsSent.push(req);
      return { txHash: hash(7000 + refundsSent.length) };
    },
    async createInvoice(req) {
      calls.push(req);
      return { txHash: hash(calls.length) };
    },
    async getBlockNumber() {
      return 1_000n;
    },
    async getRouterLogs() {
      return [];
    },
    async hasCode() {
      return true;
    },
    async passkeyAddress() {
      return PASSKEY_ADDRESS;
    },
    async usdtBalance() {
      return 0n;
    },
    async estimateGas() {
      counts.estimate++;
      return 200_000n;
    },
    async gasPrice() {
      return 5_000_000_000n;
    },
    async relayerBalance() {
      return 1_000_000_000_000_000_000n;
    },
    async sendTransaction(call) {
      sent.push(call);
      return hash(1000 + sent.length);
    },
    async waitForReceipt() {
      return { status: "success", gasUsed: 150_000n, effectiveGasPrice: 5_000_000_000n };
    },
    ...overrides,
  };
  return chain;
}

export const rejecting = (reason: string) => ({
  async estimateGas(): Promise<bigint> {
    throw new Rejected(reason);
  },
});
