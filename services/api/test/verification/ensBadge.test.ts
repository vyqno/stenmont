import { decodeFunctionData, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_CONTEXT_KEY, BUSINESS_GRANTED_KEYS, A2A_KEY, REGISTRAR_KEYS, DIRECTORY_KEYS, PAY_KEY, PROFILE_KEY, TIER_KEY, TOKEN_KEY, dnsName, permissionedResolverAbi } from "@stenmont/shared";
import type { Env } from "../../src/env";

// The real ENS client, with the chain reads and the single sender stubbed: we look at exactly what it would send.
vi.mock("viem", async (orig) => {
  const real = await orig<typeof import("viem")>();
  return {
    ...real,
    createPublicClient: () => ({
      waitForTransactionReceipt: async () => ({ status: "success" }),
      getCode: async () => "0x6001", // every proxy already exists
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "proxyLogic" ? "0x2222222222222222222222222222222222222222" : { status: 0, expiry: 0n, latestOwner: "0x0000000000000000000000000000000000000000" },
    }),
  };
});
const { viemEns } = await import("../../src/ens/client");

const REGISTRAR = "0x5E0F4e4b1c5F7d3B8d2fB1f2a6b7c9d8e1a2b3c4";
const RESOLVER = "0x4444444444444444444444444444444444444444" as Address;
const MEMBER = "0x7777777777777777777777777777777777777777" as Address;
const AGENT = "0x8888888888888888888888888888888888888888" as Address;
const NAME = "acme.stenmont.eth";

let sent: { to: Address; data: Hex }[];
beforeEach(() => (sent = []));
const env = {
  SEPOLIA_RPC: "http://localhost",
  ENS_SEND_RPC: "http://localhost",
  ENS_ROOT_NAME: "stenmont.eth",
  ENS_SUBNAME_REGISTRY: "0x1111111111111111111111111111111111111111",
  ENS_REGISTRAR_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  ENS_SENDER: { idFromName: () => "id", get: () => ({ submit: async (call: { to: Address; data: Hex }) => (sent.push(call), `0x${"ab".repeat(32)}` as Hex) }) },
} as unknown as Env;

/** Decodes every call sent into (function, args), looking inside multicall. */
function decoded(calls = sent) {
  const out: { fn: string; args: readonly unknown[] }[] = [];
  const walk = (data: Hex) => {
    try {
      const d = decodeFunctionData({ abi: permissionedResolverAbi, data });
      out.push({ fn: d.functionName, args: (d.args ?? []) as readonly unknown[] });
      if (d.functionName === "multicall") for (const inner of (d.args![0] as Hex[])) walk(inner);
    } catch {
      /* a registry or factory call, not the resolver's */
    }
  };
  for (const c of calls) walk(c.data);
  return out;
}
/** The text key a grantSetterRoles call is about (its setter argument is a setText(name, key, "") call). */
const grantedKey = (g: { args: readonly unknown[] }) => (decodeFunctionData({ abi: permissionedResolverAbi, data: g.args[0] as Hex }).args as readonly unknown[])[1] as string;

describe("the tier record is platform-only", () => {
  it("is not among the keys any business-side account is granted", () => {
    expect(TIER_KEY).toBe("stenmont.tier");
    expect(BUSINESS_GRANTED_KEYS).not.toContain(TIER_KEY);
    expect(BUSINESS_GRANTED_KEYS).toEqual([PROFILE_KEY, AGENT_CONTEXT_KEY]);
  });
  it("a team member is granted the profile record only", async () => {
    await viemEns(env).grantProfileRole({ name: NAME, resolver: RESOLVER, member: MEMBER });
    const grants = decoded().filter((c) => c.fn === "grantSetterRoles");
    expect(grants).toHaveLength(1);
    expect(grants[0]!.args[1]).toBe(MEMBER);
    expect(grantedKey(grants[0]!)).toBe(PROFILE_KEY);
  });
  it("an agent is granted its own context record only", async () => {
    await viemEns(env).createAgent({ businessName: NAME, agentRegistry: RESOLVER, label: "bot", agent: AGENT, expiresAt: 2_000_000_000, context: "c", endpoint: null, limits: "{}" });
    const toAgent = decoded().filter((c) => c.fn === "grantSetterRoles" && c.args[1] === AGENT);
    expect(toAgent.map(grantedKey)).toEqual([AGENT_CONTEXT_KEY]);
  });
  it("no call anywhere gives anyone but the registrar a right over the tier record", async () => {
    const ens = viemEns(env);
    await ens.grantProfileRole({ name: NAME, resolver: RESOLVER, member: MEMBER });
    await ens.createAgent({ businessName: NAME, agentRegistry: RESOLVER, label: "bot", agent: AGENT, expiresAt: 2_000_000_000, context: "c", endpoint: "https://x.example", limits: "{}" });
    await ens.lockPayout({ name: NAME, resolver: RESOLVER });
    await ens.setTierRecord({ name: NAME, resolver: RESOLVER, tier: 3 });
    for (const g of decoded().filter((c) => c.fn === "grantSetterRoles" && grantedKey(c) === TIER_KEY)) {
      expect((g.args[1] as string).toLowerCase()).not.toBe(MEMBER.toLowerCase());
      expect((g.args[1] as string).toLowerCase()).not.toBe(AGENT.toLowerCase());
    }
  });
});

describe("setTierRecord", () => {
  it("writes stenmont.tier on the business's own resolver, as a plain number", async () => {
    const hash = await viemEns(env).setTierRecord({ name: NAME, resolver: RESOLVER, tier: 4 });
    expect(hash).toMatch(/^0x/);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(RESOLVER);
    const [call] = decoded();
    expect(call).toMatchObject({ fn: "setText", args: [dnsName(NAME), TIER_KEY, "4"] });
  });
});

describe("lockPayout keeps the tier record writable by the registrar", () => {
  it("pre-grants the tier record to the registrar before the registrar's root rights are dropped", async () => {
    await viemEns(env).lockPayout({ name: NAME, resolver: RESOLVER });
    const calls = decoded();
    const multi = calls.find((c) => c.fn === "multicall");
    expect(multi).toBeTruthy();
    const order = calls.filter((c) => c.fn !== "multicall").map((c) => (c.fn === "grantSetterRoles" ? `grant:${grantedKey(c)}` : c.fn));
    expect(order).toEqual([`grant:${PROFILE_KEY}`, `grant:${TIER_KEY}`, ...REGISTRAR_KEYS.map((k) => `grant:${k}`), "revokeRootRoles"]);
  });
});

describe("directory records are platform-only", () => {
  it("setTextRecords writes each record to the business's resolver in one transaction", async () => {
    await viemEns(env).setTextRecords({ name: NAME, resolver: RESOLVER, records: { [PAY_KEY]: "https://pay.acme.example/c", [TOKEN_KEY]: "t" } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(RESOLVER);
    const writes = decoded().filter((c) => c.fn === "setText");
    expect(writes.map((w) => [w.args[1], w.args[2]])).toEqual([[PAY_KEY, "https://pay.acme.example/c"], [TOKEN_KEY, "t"]]);
    expect(writes.every((w) => w.args[0] === dnsName(NAME))).toBe(true);
  });
  it("refuses to write any key that is not a directory key (it cannot be used to reach the profile or tier record)", async () => {
    await expect(viemEns(env).setTextRecords({ name: NAME, resolver: RESOLVER, records: { [PROFILE_KEY]: "x" } })).rejects.toThrow();
    await expect(viemEns(env).setTextRecords({ name: NAME, resolver: RESOLVER, records: { [TIER_KEY]: "4" } })).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
  it("sends nothing when there is nothing to write", async () => {
    await viemEns(env).setTextRecords({ name: NAME, resolver: RESOLVER, records: {} });
    expect(sent).toHaveLength(0);
  });
  it("no merchant-side grant covers a directory key: members, agents and every grant that is not to the registrar exclude them", async () => {
    const ens = viemEns(env);
    await ens.grantProfileRole({ name: NAME, resolver: RESOLVER, member: MEMBER });
    await ens.createAgent({ businessName: NAME, agentRegistry: RESOLVER, label: "bot", agent: AGENT, expiresAt: 2_000_000_000, context: "c", endpoint: "https://x.example", limits: "{}" });
    await ens.lockPayout({ name: NAME, resolver: RESOLVER });
    await ens.setTextRecords({ name: NAME, resolver: RESOLVER, records: { [PAY_KEY]: "https://pay.acme.example/c" } });
    for (const key of BUSINESS_GRANTED_KEYS) expect((DIRECTORY_KEYS as readonly string[]).includes(key)).toBe(false);
    const businessSide = [MEMBER, AGENT].map((a) => a.toLowerCase());
    const toOthers = decoded().filter((c) => c.fn === "grantSetterRoles" && businessSide.includes((c.args[1] as string).toLowerCase()));
    expect(toOthers.map(grantedKey).sort()).toEqual([AGENT_CONTEXT_KEY, PROFILE_KEY]);
    for (const g of decoded().filter((c) => c.fn === "grantSetterRoles" && (DIRECTORY_KEYS as readonly string[]).includes(grantedKey(c)))) {
      expect((g.args[1] as string).toLowerCase()).not.toBe(MEMBER.toLowerCase());
      expect((g.args[1] as string).toLowerCase()).not.toBe(AGENT.toLowerCase());
    }
  });
  it("lockPayout pre-grants every directory key to the registrar before its root rights are dropped", async () => {
    await viemEns(env).lockPayout({ name: NAME, resolver: RESOLVER });
    const granted = decoded().filter((c) => c.fn === "grantSetterRoles").map(grantedKey);
    for (const k of DIRECTORY_KEYS) expect(granted).toContain(k);
  });
});

it("reserves A2A writes to the registrar and retains its permission after payout lock", async () => {
  expect(DIRECTORY_KEYS).toHaveLength(5);
  expect(BUSINESS_GRANTED_KEYS).not.toContain(A2A_KEY);
  const client = viemEns(env);
  await client.grantProfileRole({ name: NAME, resolver: RESOLVER, member: MEMBER });
  await client.lockPayout({ name: NAME, resolver: RESOLVER });
  const grants = decoded().filter(c => c.fn === "grantSetterRoles" && grantedKey(c) === A2A_KEY);
  expect(grants).toHaveLength(1);
  expect(grants[0]!.args[1]).not.toBe(MEMBER);
  await client.setTextRecords({ name: NAME, resolver: RESOLVER, records: { [A2A_KEY]: "https://api.example/a2a/m1/agent-card.json" } });
  expect(decoded().some(c => c.fn === "setText" && c.args[1] === A2A_KEY)).toBe(true);
});
