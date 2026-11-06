import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, stringToBytes, toHex, type Address, type Hex } from "viem";
import { namehash, packetToBytes } from "viem/ens";

/** ENSv2 on Sepolia (the ENS contracts are not ours). Verified against the deployed bytecode by scripts/spikes/ens-v2.mjs. */
export const ENS_SEPOLIA = {
  chainId: 11155111,
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  verifiableFactory: "0xDa70306C98E97eCe36F997a21368e53298572991",
  userRegistryImpl: "0x9BD8a88719068D09ecee662f36C0E3856708366a",
  permissionedResolverImpl: "0x115eb53F0c60696633855F90b138178Fb40b2b2C",
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
} as const satisfies Record<string, Address | number>;

/** Enhanced Access Control packs each role into a 4-bit group; the admin of a role sits 128 bits higher. */
export const ALL_ROLES = BigInt("0x" + "1".repeat(64));
export const ROLE = {
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  // registry roles
  REGISTRAR: 1n << 0n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
} as const;
export const adminOf = (role: bigint) => role << 128n;
/** Edit and delegate one kind of record. */
export const TEXT_RIGHTS = ROLE.SET_TEXT | adminOf(ROLE.SET_TEXT);
export const ADDR_RIGHTS = ROLE.SET_ADDRESS | adminOf(ROLE.SET_ADDRESS);

export const ETH_COIN_TYPE = 60n;
export const PAYOUT_KEY = "stenmont.payout";
export const PROFILE_KEY = "stenmont.profile";
export const AGENT_CONTEXT_KEY = "agent-context";
export const AGENT_ENDPOINT_KEY = "agent-endpoint[mcp]";
export const AGENT_POLICY_KEY = "stenmont.agent.policy";

export const ensRegistryAbi = parseAbi([
  "function getState(uint256 anyId) view returns ((uint8 status, uint64 expiry, address latestOwner, uint256 tokenId, uint256 resource))",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expires) returns (uint256 tokenId)",
  "function setResolver(uint256 anyId, address resolver)",
  "function setSubregistry(uint256 tokenId, address registry)",
  "function unregister(uint256 anyId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function initialize((address account, uint256 roleBitmap)[] grants)",
]);
export const verifiableFactoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "function proxyLogic() view returns (address)",
]);
export const permissionedResolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
  "function setText(bytes name, string key, string value)",
  "function multicall(bytes[] calls) returns (bytes[] results)",
  "function grantSetterRoles(bytes setter, address account) returns (bool)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account) returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function grantRootRoles(uint256 roleBitmap, address account) returns (bool)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
  "function roles(uint256 resource, address account) view returns (uint256)",
  "function resolve(bytes name, bytes data) view returns (bytes)",
]);

/** Reads go through the resolver's extended `resolve(name, data)`: the data is the ordinary text(node,key) or addr(node) call. */
export const textQuery = (name: string, key: string): Hex =>
  encodeFunctionData({ abi: parseAbi(["function text(bytes32 node, string key) view returns (string)"]), functionName: "text", args: [namehash(name), key] });
export const addrQuery = (name: string): Hex =>
  encodeFunctionData({ abi: parseAbi(["function addr(bytes32 node) view returns (address)"]), functionName: "addr", args: [namehash(name)] });

/** A DNS-encoded name, which is how the deployed resolver takes names in its setters. */
export const dnsName = (name: string): Hex => toHex(packetToBytes(name));
export const nodeOf = (name: string): Hex => namehash(name);
export const decodeTextAnswer = (data: Hex): string => decodeAbiParameters([{ type: "string" }], data)[0];
export const decodeAddrAnswer = (data: Hex): Address => decodeAbiParameters([{ type: "address" }], data)[0];

/**
 * In the deployed resolver a permission is scoped to a record KEY (not to a name), so every name that needs its own
 * permissions has its own resolver. A text key's access-control resource is keccak256(key); an address record's is
 * keccak256(abi.encode(coinType)).
 */
export const textResource = (key: string): bigint => BigInt(keccak256(stringToBytes(key)));
export const addrResource = (coinType: bigint): bigint => BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [coinType])));

/** The setter call whose key a role is being granted for (the value is ignored). `grantSetterRoles` decodes it. */
export const textSetter = (name: string, key: string): Hex =>
  encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName(name), key, ""] });
export const addrSetter = (name: string, coinType: bigint): Hex =>
  encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setAddress", args: [dnsName(name), coinType, "0x"] });

/** A business label: lowercase letters, digits and hyphens, 3 to 32 characters, no hyphen at either end. */
export const BUSINESS_LABEL = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;
