import type { Address, Hex } from "viem";
import type { EnsClient } from "../../src/ens/client";

export const RESOLVER = "0x4444444444444444444444444444444444444444" as const;
export const AGENT_REGISTRY = "0x5555555555555555555555555555555555555555" as const;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

/** Fake ENS: remembers what it was asked to do and which labels are taken on chain. */
export function fakeEns(overrides: Partial<EnsClient> = {}) {
  const taken = new Set<string>();
  const claims: { label: string; payout: Address }[] = [];
  const finance: { name: string; member: Address }[] = [];
  const locks: string[] = [];
  const agents: Parameters<EnsClient["createAgent"]>[0][] = [];
  const revoked: Parameters<EnsClient["revokeAgent"]>[0][] = [];
  const primaryNames = new Map<string, string>();
  const tierWrites: { name: string; resolver: Address; tier: number }[] = [];
  const ens: EnsClient & { primaryNames: Map<string, string>; tierWrites: typeof tierWrites; taken: Set<string>; claims: typeof claims; finance: typeof finance; locks: string[]; agents: typeof agents; revoked: typeof revoked } = {
    primaryNames,
    tierWrites,
    async setTierRecord(a) {
      tierWrites.push(a);
      return hash(9500 + tierWrites.length);
    },
    async primaryName(a) {
      return primaryNames.get(a.toLowerCase()) ?? null;
    },
    agents,
    revoked,
    taken,
    claims,
    finance,
    locks,
    async labelAvailable(label) {
      return !taken.has(label);
    },
    async claimBusinessName(a) {
      claims.push(a);
      taken.add(a.label);
      return { name: `${a.label}.stenmont.eth`, resolver: RESOLVER, agentRegistry: AGENT_REGISTRY, txHashes: [hash(9001), hash(9002), hash(9003)] };
    },
    async grantProfileRole(a) {
      finance.push({ name: a.name, member: a.member });
      return hash(9100 + finance.length);
    },
    async lockPayout(a) {
      locks.push(a.name);
      return hash(9200 + locks.length);
    },
    async agentLabelAvailable(a) {
      return !taken.has(`${a.label}.${a.businessName}`);
    },
    async createAgent(a) {
      agents.push(a);
      taken.add(`${a.label}.${a.businessName}`);
      return { name: `${a.label}.${a.businessName}`, resolver: RESOLVER, txHashes: [hash(9300), hash(9301), hash(9302)] };
    },
    async revokeAgent(a) {
      revoked.push(a);
      return [hash(9400), hash(9401)];
    },
    async resolveAddress() {
      return null;
    },
    ...overrides,
  };
  return ens;
}
