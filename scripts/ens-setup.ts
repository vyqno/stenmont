// Task 5.2: gives stenmont.eth a subname registry on Sepolia and a registrar wallet that may issue subnames.
// Safe to re-run: every step checks what already exists. Prints addresses, never keys.
//   pnpm --filter @stenmont/scripts ens-setup
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeAbiParameters, encodeFunctionData, formatEther, http, keccak256, parseAbi, parseEther, stringToBytes, zeroAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { labelhash, namehash } from "viem/ens";

const ROOT = join(import.meta.dirname, "..");
const NAME = "stenmont.eth";
const ETH_REGISTRY = "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4" as const;
const FACTORY = "0xDa70306C98E97eCe36F997a21368e53298572991" as const;
const REGISTRY_IMPL = "0x9BD8a88719068D09ecee662f36C0E3856708366a" as const;
const ALL_ROLES = BigInt("0x" + "1".repeat(64));

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k} in .env`);
  return v as Hex;
};

const ethRegistry = parseAbi([
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))",
  "function getSubregistry(string label) view returns (address)",
  "function setSubregistry(uint256 tokenId, address registry)",
]);
const factory = parseAbi(["function deployProxy(address implementation, uint256 salt, bytes data) returns (address)"]);
const userRegistry = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
]);

const rpc = process.env.SEPOLIA_RPC || "https://sepolia.gateway.tenderly.co";
const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
const deployer = privateKeyToAccount(need("STENMONT_DEPLOYER_PRIVATE_KEY"));
// Reads go to the archive-capable RPC; sends go through a plain public one (the gateway limits raw transactions).
const wallet = createWalletClient({ account: deployer, chain: sepolia, transport: http(process.env.SEPOLIA_SEND_RPC || "https://ethereum-sepolia-rpc.publicnode.com") });
const send = async (label: string, hash: Hex) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
  console.log(`  ${label}: ${hash}`);
};

// 1. the registrar wallet (its key lives in .env and then in Cloudflare; this script never prints it)
const envPath = join(ROOT, ".env");
if (!process.env.STENMONT_ENS_REGISTRAR_PRIVATE_KEY) {
  const key = generatePrivateKey();
  appendFileSync(envPath, `\nSTENMONT_ENS_REGISTRAR_ADDRESS=${privateKeyToAccount(key).address}\nSTENMONT_ENS_REGISTRAR_PRIVATE_KEY=${key}\n`);
  process.env.STENMONT_ENS_REGISTRAR_PRIVATE_KEY = key;
  console.log("created a registrar wallet and saved it to .env");
}
const registrar = privateKeyToAccount(need("STENMONT_ENS_REGISTRAR_PRIVATE_KEY"));
console.log("registrar:", registrar.address);

// 2. fuel it with Sepolia ETH for subname transactions
const bal = await pub.getBalance({ address: registrar.address });
if (bal < parseEther("0.1")) await send("fund registrar 0.3 ETH", await wallet.sendTransaction({ to: registrar.address, value: parseEther("0.3") }));
console.log("registrar balance:", formatEther(await pub.getBalance({ address: registrar.address })), "ETH");

// 3. the subname registry for stenmont.eth
let registry = await pub.readContract({ address: ETH_REGISTRY, abi: ethRegistry, functionName: "getSubregistry", args: ["stenmont"] });
if (registry === zeroAddress) {
  const salt = BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [keccak256(stringToBytes("UserRegistry")), namehash(NAME), 0n])));
  const init = encodeFunctionData({ abi: userRegistry, functionName: "initialize", args: [[{ account: deployer.address, roleBitmap: ALL_ROLES }]] });
  const sim = await pub.simulateContract({ account: deployer, address: FACTORY, abi: factory, functionName: "deployProxy", args: [REGISTRY_IMPL, salt, init] });
  await send("deploy UserRegistry", await wallet.writeContract(sim.request));
  registry = sim.result;
  const state = await pub.readContract({ address: ETH_REGISTRY, abi: ethRegistry, functionName: "getState", args: [BigInt(labelhash("stenmont"))] });
  await send("point stenmont.eth at it", await wallet.writeContract({ address: ETH_REGISTRY, abi: ethRegistry, functionName: "setSubregistry", args: [state.tokenId, registry] }));
}
console.log("stenmont.eth subregistry:", registry);

// 4. let the registrar issue subnames (all roles on the registry's root, including the admin roles)
if (!(await pub.readContract({ address: registry, abi: userRegistry, functionName: "hasRootRoles", args: [ALL_ROLES, registrar.address] }))) {
  await send("grant registrar all roles", await wallet.writeContract({ address: registry, abi: userRegistry, functionName: "grantRootRoles", args: [ALL_ROLES, registrar.address] }));
}

// 5. record it
const file = join(ROOT, "contracts", "deployments", "11155111.json");
writeFileSync(
  file,
  JSON.stringify(
    {
      chainId: 11155111,
      name: NAME,
      note: "ENSv2 on Sepolia. The ENS contracts are not ours; these are the ones we use and the ones we created.",
      ens: { ETHRegistry: ETH_REGISTRY, VerifiableFactory: FACTORY, UserRegistryImpl: REGISTRY_IMPL, UniversalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe" },
      stenmont: { parentResolver: "0xcE7f94E522d7C5Eedaaf82bb76B80FD6a80eA8D4", subnameRegistry: registry, registrar: registrar.address },
    },
    null,
    2,
  ) + "\n",
);
console.log("recorded in contracts/deployments/11155111.json");
void readFileSync;
