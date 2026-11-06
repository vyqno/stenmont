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
  const ens: EnsClient & { taken: Set<string>; claims: typeof claims; finance: typeof finance; locks: string[] } = {
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
    async resolveAddress() {
      return null;
    },
    ...overrides,
  };
  return ens;
}
