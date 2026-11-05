import type { ChainClient } from "../../src/chain";

/** Fake chain: records createInvoice calls, serves canned logs. */
export function fakeChain(overrides: Partial<ChainClient> = {}) {
  const calls: unknown[] = [];
  const chain: ChainClient & { calls: unknown[] } = {
    calls,
    async createInvoice(req) {
      calls.push(req);
      return { txHash: `0x${String(calls.length).padStart(64, "0")}` as `0x${string}` };
    },
    async getBlockNumber() {
      return 1_000n;
    },
    async getRouterLogs() {
      return [];
    },
    ...overrides,
  };
  return chain;
}
