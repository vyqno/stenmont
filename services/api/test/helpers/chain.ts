import { Rejected, type ChainClient } from "../../src/chain";
import type { Call } from "../../src/relayer/sender";

export const PASSKEY_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;

/** Fake chain: records everything it is asked to do and serves canned answers. */
export function fakeChain(overrides: Partial<ChainClient> = {}) {
  const calls: unknown[] = [];
  const sent: Call[] = [];
  const counts = { estimate: 0 };
  const chain: ChainClient & { calls: unknown[]; sent: Call[]; counts: typeof counts } = {
    calls,
    sent,
    counts,
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
