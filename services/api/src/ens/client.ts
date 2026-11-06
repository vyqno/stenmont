import { concat, createPublicClient, encodeAbiParameters, encodeFunctionData, fallback, getContractAddress, http, keccak256, stringToBytes, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash } from "viem/ens";
import {
  ADDR_RIGHTS,
  AGENT_CONTEXT_KEY,
  AGENT_ENDPOINT_KEY,
  AGENT_POLICY_KEY,
  ALL_ROLES,
  ENS_SEPOLIA as E,
  ETH_COIN_TYPE,
  PAYOUT_KEY,
  PROFILE_KEY,
  ROLE,
  TIER_KEY,
  REGISTRAR_KEYS,
  TEXT_RIGHTS,
  textResource,
  dnsName,
  ensRegistryAbi,
  permissionedResolverAbi,
  textSetter,
  verifiableFactoryAbi,
} from "@stenmont/shared";
import type { Env } from "../env";

export type ClaimResult = { name: string; resolver: Address; agentRegistry: Address; txHashes: Hex[] };

export type AgentInput = {
  businessName: string;
  agentRegistry: Address;
  label: string;
  agent: Address;
  /** Unix seconds. After this the name stops resolving. */
  expiresAt: number;
  context: string;
  endpoint: string | null;
  /** JSON published as a text record so anyone can read the agent's policy. */
  limits: string;
};

export interface EnsClient {
  /** True when the agent label is free in the business's agent registry. */
  agentLabelAvailable(a: { businessName: string; agentRegistry: Address; label: string }): Promise<boolean>;
  /**
   * Makes an agent a name under the business: its own resolver (identity, endpoint, policy), the name owned by the
   * agent, and the agent's right to edit only its own `agent-context` record. Safe to repeat after a failure.
   */
  createAgent(a: AgentInput): Promise<{ name: string; resolver: Address; txHashes: Hex[] }>;
  /** Takes the agent's right to edit its record away and removes its name. */
  revokeAgent(a: { name: string; label: string; agentRegistry: Address; resolver: Address; agent: Address }): Promise<Hex[]>;
  /** True when the label is free in the subname registry (nobody registered it, even outside our database). */
  labelAvailable(label: string): Promise<boolean>;
  /**
   * Gives a business its name: an agent registry, its own resolver (address and payout set), and the subname owned by the
   * business's payout account. Safe to repeat after a failure: steps that already happened are skipped.
   */
  claimBusinessName(a: { label: string; payout: Address }): Promise<ClaimResult>;
  /** Lets a team member edit only the profile record. Only possible before the payout is locked. */
  grantProfileRole(a: { name: string; resolver: Address; member: Address }): Promise<Hex>;
  /** Permanently takes the registrar's rights over the payout record (it keeps the profile record). */
  lockPayout(a: { name: string; resolver: Address }): Promise<Hex>;
  /**
   * Publishes the business's trust tier as the text record `stenmont.tier`. Only the platform's registrar can write it:
   * the business, its team members and its agents are never granted a role for this record.
   */
  setTierRecord(a: { name: string; resolver: Address; tier: number }): Promise<Hex>;
  /**
   * Writes directory and policy text records (only `REGISTRAR_KEYS`; any other key is refused) in one transaction. Like the tier
   * record, only the platform's registrar can write them: the business, its team and its agents hold no right over these keys.
   */
  setTextRecords(a: { name: string; resolver: Address; records: Record<string, string> }): Promise<Hex | null>;
  /** The ENS primary name an address has set, or null. Read-only and best effort: a lookup failure is the same as no name. */
  primaryName(address: Address): Promise<string | null>;
  /** The address a name points to, or null when it does not resolve. */
  resolveAddress(name: string, options?: { strict: boolean }): Promise<Address | null>;
}

export class EnsRejected extends Error {}

const CALL_ROOT_RIGHTS = TEXT_RIGHTS | ADDR_RIGHTS;
const salt = (kind: string, name: string) => BigInt(keccak256(stringToBytes(`${kind}:${name}`)));

export function viemEns(env: Env): EnsClient {
  // The public gateways rate-limit shared Worker addresses, so reads try the primary and then a second provider.
  const transport = fallback([http(env.SEPOLIA_RPC), http(env.ENS_SEND_RPC || "https://ethereum-sepolia-rpc.publicnode.com")], { retryCount: 2 });
  const reader = createPublicClient({ chain: sepolia, transport });
  const registrar = privateKeyToAccount(env.ENS_REGISTRAR_PRIVATE_KEY as Hex).address;
  const parentName = env.ENS_ROOT_NAME;
  const parentLabel = parentName.split(".")[0]!;
  const registry = env.ENS_SUBNAME_REGISTRY as Address;
  const sender = () => env.ENS_SENDER.get(env.ENS_SENDER.idFromName("registrar"));

  const hasCode = async (a: Address) => ((await reader.getCode({ address: a })) ?? "0x") !== "0x";
  /** Sends one transaction through the single sender and waits for it, so the next step sees its effects. */
  const run = async (to: Address, data: Hex): Promise<Hex> => {
    const hash = await sender().submit({ to, data });
    const r = await reader.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (r.status !== "success") throw new EnsRejected(`transaction reverted: ${hash}`);
    return hash;
  };
  /** The address a proxy gets for (registrar, salt): the factory deploys it with CREATE2, so it can be known in advance. */
  const predictProxy = async (s: bigint): Promise<Address> => {
    const logic = await reader.readContract({ address: E.verifiableFactory, abi: verifiableFactoryAbi, functionName: "proxyLogic" });
    const outer = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [registrar, s]));
    const bytecode = concat(["0x3d604d80600a3d3981f3363d3d373d3d3d363d73", logic, "0x5af43d82803e903d91602b57fd5bf3", outer]);
    return getContractAddress({ bytecode, from: E.verifiableFactory, opcode: "CREATE2", salt: outer });
  };
  /** Deploys a proxy unless it is already there, so repeating a half-finished claim does not fail on a step it already did. */
  const deploy = async (implementation: Address, s: bigint, init: Hex, hashes: Hex[]): Promise<Address> => {
    const address = await predictProxy(s);
    if (await hasCode(address)) return address;
    hashes.push(await run(E.verifiableFactory, encodeFunctionData({ abi: verifiableFactoryAbi, functionName: "deployProxy", args: [implementation, s, init] })));
    if (!(await hasCode(address))) throw new EnsRejected("the proxy was not created where expected");
    return address;
  };

  return {
    async labelAvailable(label) {
      const st = await reader.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] });
      return st.status === 0; // AVAILABLE
    },

    async claimBusinessName({ label, payout }) {
      const name = `${label}.${parentName}`;
      const hashes: Hex[] = [];
      const parent = await reader.readContract({ address: E.ethRegistry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(parentLabel))] });

      const agentInit = encodeFunctionData({ abi: ensRegistryAbi, functionName: "initialize", args: [[{ account: registrar, roleBitmap: ALL_ROLES }]] });
      const agentRegistry = await deploy(E.userRegistryImpl, salt("agentRegistry", name), agentInit, hashes);

      const setters = [
        encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setAddress", args: [dnsName(name), ETH_COIN_TYPE, payout] }),
        encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), PAYOUT_KEY, payout] }),
      ];
      const resolverInit = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "initialize", args: [[{ account: registrar, roleBitmap: CALL_ROOT_RIGHTS }], setters] });
      const resolver = await deploy(E.permissionedResolverImpl, salt("resolver", name), resolverInit, hashes);

      // The business's payout account owns the name; it holds no rights, so nothing about the name can change under it.
      const existing = await reader.readContract({ address: registry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] });
      if (existing.status !== 0) {
        if (existing.latestOwner.toLowerCase() !== payout.toLowerCase()) throw new EnsRejected("label already registered to someone else");
        return { name, resolver, agentRegistry, txHashes: hashes }; // a previous attempt got this far
      }
      hashes.push(await run(registry, encodeFunctionData({ abi: ensRegistryAbi, functionName: "register", args: [label, payout, agentRegistry, resolver, 0n, parent.expiry] })));
      return { name, resolver, agentRegistry, txHashes: hashes };
    },

    async grantProfileRole({ name, resolver, member }) {
      return run(resolver, encodeFunctionData({ abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [textSetter(name, PROFILE_KEY), member] }));
    },

    async lockPayout({ name, resolver }) {
      // The registrar keeps the records it must still be able to write (profile, the tier badge and the pay directory) when its root rights go.
      const keep = (key: string) => encodeFunctionData({ abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [textSetter(name, key), registrar] });
      const dropRoot = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "revokeRootRoles", args: [CALL_ROOT_RIGHTS, registrar] });
      return run(resolver, encodeFunctionData({ abi: permissionedResolverAbi, functionName: "multicall", args: [[keep(PROFILE_KEY), keep(TIER_KEY), ...REGISTRAR_KEYS.map(keep), dropRoot]] }));
    },

    async setTierRecord({ name, resolver, tier }) {
      return run(resolver, encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), TIER_KEY, String(tier)] }));
    },

    async setTextRecords({ name, resolver, records }) {
      const entries = Object.entries(records);
      if (entries.some(([k]) => !(REGISTRAR_KEYS as readonly string[]).includes(k))) throw new EnsRejected("only registrar directory and policy records can be written here");
      if (entries.length === 0) return null;
      const set = ([key, value]: [string, string]) => encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), key, value] });
      return run(resolver, encodeFunctionData({ abi: permissionedResolverAbi, functionName: "multicall", args: [entries.map(set)] }));
    },

    async agentLabelAvailable({ agentRegistry, label }) {
      const st = await reader.readContract({ address: agentRegistry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] });
      return st.status === 0;
    },

    async createAgent(a) {
      const name = `${a.label}.${a.businessName}`;
      const hashes: Hex[] = [];
      const text = (key: string, value: string) => encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), key, value] });
      const setters = [
        encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setAddress", args: [dnsName(name), ETH_COIN_TYPE, a.agent] }),
        text(AGENT_CONTEXT_KEY, a.context),
        text(AGENT_POLICY_KEY, a.limits),
        ...(a.endpoint ? [text(AGENT_ENDPOINT_KEY, a.endpoint)] : []),
      ];
      const init = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "initialize", args: [[{ account: registrar, roleBitmap: CALL_ROOT_RIGHTS }], setters] });
      const resolver = await deploy(E.permissionedResolverImpl, salt("agentResolver", name), init, hashes);

      const existing = await reader.readContract({ address: a.agentRegistry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(a.label))] });
      if (existing.status === 0) {
        hashes.push(await run(a.agentRegistry, encodeFunctionData({ abi: ensRegistryAbi, functionName: "register", args: [a.label, a.agent, zeroAddress, resolver, 0n, BigInt(a.expiresAt)] })));
      } else if (existing.latestOwner.toLowerCase() !== a.agent.toLowerCase()) {
        throw new EnsRejected("agent label already registered to someone else");
      }
      // The agent may edit this one record of its own name, and nothing else.
      hashes.push(await run(resolver, encodeFunctionData({ abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [textSetter(name, AGENT_CONTEXT_KEY), a.agent] })));
      return { name, resolver, txHashes: hashes };
    },

    async revokeAgent({ label, agentRegistry, resolver, agent }) {
      const hashes: Hex[] = [];
      hashes.push(await run(resolver, encodeFunctionData({ abi: permissionedResolverAbi, functionName: "revokeRoles", args: [textResource(AGENT_CONTEXT_KEY), ROLE.SET_TEXT, agent] })));
      const st = await reader.readContract({ address: agentRegistry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(labelhash(label))] });
      if (st.status === 2) hashes.push(await run(agentRegistry, encodeFunctionData({ abi: ensRegistryAbi, functionName: "unregister", args: [BigInt(labelhash(label))] })));
      return hashes;
    },

    async primaryName(address) {
      return reader.getEnsName({ address }).catch(() => null);
    },

    async resolveAddress(name, options) {
      const a = await reader.getEnsAddress({ name }).catch((e: unknown) => {
        if (options?.strict) throw e;
        return null;
      });
      return a && a !== zeroAddress ? a : null;
    },
  };
}
