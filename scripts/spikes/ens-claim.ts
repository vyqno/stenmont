// Spike for Tasks 5.3 and 5.4: does the role design work on the live ENSv2 contracts?
//   per-business resolver, registrar limited to per-record roles, a finance member limited to one record,
//   and a payout lock that nobody (not even the registrar) can undo.
//   pnpm --filter @stenmont/scripts exec tsx --env-file=../.env spikes/ens-claim.ts
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, http, keccak256, parseEther, stringToBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  ADDR_RIGHTS, ENS_SEPOLIA as E, ETH_COIN_TYPE, PAYOUT_KEY, PROFILE_KEY, TEXT_RIGHTS,
  addrSetter, decodeAddrAnswer, decodeTextAnswer, addrQuery, textQuery, dnsName, ensRegistryAbi, nodeOf, permissionedResolverAbi, textSetter, verifiableFactoryAbi,
} from "@stenmont/shared";
import deployments from "../../contracts/deployments/11155111.json" with { type: "json" };

const need = (k: string) => process.env[k] as Hex;
const read = http(process.env.SEPOLIA_RPC || "https://sepolia.gateway.tenderly.co");
const send = http("https://ethereum-sepolia-rpc.publicnode.com");
const pub = createPublicClient({ chain: sepolia, transport: read });
const registrar = privateKeyToAccount(need("STENMONT_ENS_REGISTRAR_PRIVATE_KEY"));
const reg = createWalletClient({ account: registrar, chain: sepolia, transport: send });
const parentRegistry = deployments.stenmont.subnameRegistry as Hex;

const label = `spike${Date.now().toString(36)}`;
const name = `${label}.stenmont.eth`;
const node = nodeOf(name);
const owner = "0x2222222222222222222222222222222222222222" as const; // stands in for the business's payout account
const results: [string, boolean][] = [];
const check = (what: string, ok: boolean) => (results.push([what, ok]), console.log(ok ? "PASS" : "FAIL", what));
const wait = async (h: Hex) => {
  const r = await pub.waitForTransactionReceipt({ hash: h });
  if (r.status !== "success") throw new Error(`reverted ${h}`);
  return r;
};
/** Does this call succeed? (simulated, so nothing is sent) */
const works = (fn: () => Promise<unknown>) => fn().then(() => true, () => false);

// T1: the business's own resolver. The registrar holds only record-edit rights at the root for now.
const BOOT = TEXT_RIGHTS | ADDR_RIGHTS;
const setters = [
  encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setAddress", args: [dnsName(name), ETH_COIN_TYPE, owner] }),
  encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), PAYOUT_KEY, owner] }),
];
const salt = BigInt(keccak256(stringToBytes(`resolver:${name}`)));
const init = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "initialize", args: [[{ account: registrar.address, roleBitmap: BOOT }], setters] });
const sim = await pub.simulateContract({ account: registrar, address: E.verifiableFactory, abi: verifiableFactoryAbi, functionName: "deployProxy", args: [E.permissionedResolverImpl, salt, init] });
await wait(await reg.writeContract(sim.request));
const resolver = sim.result;
console.log("resolver", resolver);

// T2: the subname itself, owned by the business's account, using this resolver
const parent = await pub.readContract({ address: E.ethRegistry, abi: ensRegistryAbi, functionName: "getState", args: [BigInt(keccak256(stringToBytes("stenmont")))] });
await wait(await reg.writeContract({ address: parentRegistry, abi: ensRegistryAbi, functionName: "register", args: [label, owner, "0x0000000000000000000000000000000000000000", resolver, 0n, parent.expiry] }));
console.log("registered", name);

// finance member: may edit only the profile record. Granted by the registrar while it still has its root rights.
const member = privateKeyToAccount(generatePrivateKey());
await wait(await reg.sendTransaction({ to: member.address, value: parseEther("0.01") }));
await wait(await reg.writeContract({ address: resolver, abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [textSetter(name, PROFILE_KEY), member.address] }));

const setText = (account: Hex | typeof registrar, key: string, value: string) =>
  pub.simulateContract({ account: account as never, address: resolver, abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), key, value] });
const setAddr = (a: string) =>
  pub.simulateContract({ account: registrar, address: resolver, abi: permissionedResolverAbi, functionName: "setAddress", args: [dnsName(name), ETH_COIN_TYPE, a as Hex] });
const memberWallet = createWalletClient({ account: member, chain: sepolia, transport: send });

check("before the lock the registrar can change the payout", await works(() => setText(registrar, PAYOUT_KEY, owner)));
check("finance member can edit the profile record", await works(() => setText(member, PROFILE_KEY, "set by finance")));
check("finance member can NOT touch the payout record", !(await works(() => setText(member, PAYOUT_KEY, member.address))));
check("finance member can NOT touch an unrelated record", !(await works(() => setText(member, "some.other", "x"))));
await wait(await memberWallet.writeContract({ address: resolver, abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), PROFILE_KEY, "set by finance"] }));
check("the member's edit is on chain", decodeTextAnswer(await pub.readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "resolve", args: [dnsName(name), textQuery(name, PROFILE_KEY)] })) === "set by finance");

// THE LOCK: keep only the profile key for the registrar, then drop its root rights (which also drops its right to hand rights out)
await wait(
  await reg.writeContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "multicall",
    args: [[
      encodeFunctionData({ abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [textSetter(name, PROFILE_KEY), registrar.address] }),
      encodeFunctionData({ abi: permissionedResolverAbi, functionName: "revokeRootRoles", args: [BOOT, registrar.address] }),
    ]],
  }),
);
check("after the lock the registrar can NOT change the payout text", !(await works(() => setText(registrar, PAYOUT_KEY, "0x3333333333333333333333333333333333333333"))));
check("after the lock the registrar can NOT change the payout address", !(await works(() => setAddr("0x3333333333333333333333333333333333333333"))));
check("after the lock the registrar can NOT give itself the rights back", !(await works(() => pub.simulateContract({ account: registrar, address: resolver, abi: permissionedResolverAbi, functionName: "grantSetterRoles", args: [textSetter(name, PAYOUT_KEY), registrar.address] }))));
check("after the lock the registrar can NOT grant root rights back", !(await works(() => pub.simulateContract({ account: registrar, address: resolver, abi: permissionedResolverAbi, functionName: "grantRootRoles", args: [BOOT, registrar.address] }))));
check("the lock does not stop the profile record (registrar)", await works(() => setText(registrar, PROFILE_KEY, "still editable")));
check("the lock does not stop the profile record (finance member)", await works(() => setText(member, PROFILE_KEY, "still editable by finance")));
check("the name resolves to the business", decodeAddrAnswer(await pub.readContract({ address: resolver, abi: permissionedResolverAbi, functionName: "resolve", args: [dnsName(name), addrQuery(name)] })).toLowerCase() === owner);
check("and the registry points the name at this resolver", (await pub.readContract({ address: parentRegistry, abi: ensRegistryAbi, functionName: "getResolver", args: [label] })).toLowerCase() === resolver.toLowerCase());

console.log(results.every(([, ok]) => ok) ? "\nALL PASS" : "\nSOME FAILED");
void encodeAbiParameters; void addrSetter; void ADDR_RIGHTS;
