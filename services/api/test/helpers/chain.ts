import type { Address, Hex } from "viem";
import { verifyWalletSignature } from "../../src/verification/siwe";
import { Rejected, type ActivateRequest, type AllowInvestorRequest, type ChainClient, type ClaimLog, type ClaimState, type ListClaimRequest, type RefundRequest } from "../../src/chain";
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
  const listed: ListClaimRequest[] = [];
  const allowedSent: AllowInvestorRequest[] = [];
  /** Investors the fake registry allows, claim states and reputation records it serves, and logs it emits. */
  const allowed = new Set<string>();
  const claimStates = new Map<string, ClaimState>();
  const reputation = new Map<string, { onTime: number; late: number; volume: bigint; score: number }>();
  const claimLogs: ClaimLog[] = [];
  /** Smart-account wallets the fake chain knows: the check that decides their ERC-1271 answer. */
  const contractWallets = new Map<string, (hash: Hex, signature: Hex) => boolean>();
  const chain: ChainClient & {
    contractWallets: typeof contractWallets;
    calls: unknown[]; sent: Call[]; activations: ActivateRequest[]; refundsSent: RefundRequest[]; counts: typeof counts;
    listed: ListClaimRequest[]; allowedSent: AllowInvestorRequest[]; allowed: Set<string>; claimStates: Map<string, ClaimState>;
    reputation: typeof reputation; claimLogs: ClaimLog[];
  } = {
    contractWallets,
    async verifyWalletSignature(req) {
      return verifyWalletSignature(
        {
          getCode: async (a: Address) => (contractWallets.has(a.toLowerCase()) ? ("0x6001" as Hex) : undefined),
          isValidSignature: async (a: Address, h: Hex, s: Hex) => (contractWallets.get(a.toLowerCase())?.(h, s) ? "0x1626ba7e" : "0xffffffff"),
        },
        req,
      );
    },
    listed,
    allowedSent,
    allowed,
    claimStates,
    reputation,
    claimLogs,
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
    async listClaim(req) {
      listed.push(req);
      return { txHash: hash(8000 + listed.length) };
    },
    async allowInvestor(req) {
      allowedSent.push(req);
      allowed.add(req.investor.toLowerCase());
      return { txHash: hash(9000 + allowedSent.length) };
    },
    async claimState(id) {
      return claimStates.get(id) ?? { status: "none", received: 0n, toHolder: 0n, fundBy: 0n };
    },
    async reputationOf(a) {
      return reputation.get(a.toLowerCase()) ?? { onTime: 0, late: 0, volume: 0n, score: 0 };
    },
    async investorAllowed(a) {
      return allowed.has(a.toLowerCase());
    },
    async investorNonce() {
      return 0n;
    },
    async getClaimLogs() {
      return claimLogs;
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
    async usdtNonce() {
      return 0n;
    },
    async usdtAllowance() {
      return 0n;
    },
    async usdtSentSince() {
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
