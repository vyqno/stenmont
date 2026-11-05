// Spike 0.2: does Whitechain Sepolia answer the P-256 verify precompile (RIP-7212) at 0x100?
//   pnpm --filter @stenmont/scripts spike:p256
// The vector (hash || r || s || x || y, 160 bytes) was produced by Foundry's vm.signP256 and is also verified by
// OpenZeppelin's Solidity fallback in contracts/test/P256.t.sol, so a failure here means the chain, not the vector.
import { createPublicClient, http, type Hex } from "viem";
import { whitechainSepolia } from "@stenmont/shared";

const PRECOMPILE = "0x0000000000000000000000000000000000000100" as const;
const VALID = "0x8da82ccdaee87a02fe304d4c1ebe28852373c5678296fce464cdc889e1dd23871efb4a0714db102545f739eba83d70f113ec2eb59035c736dfedfcb4d04ecbb12d40c4154adeb15a1835a3b7d8b1655cd8e21c9161000d4d775a891acfb753c67268876e19db7d7a651d55d5f3cd08b0f14f0f2d99ac383d56e705cc58b2de09272f3460d10844d9d8a77c0f6f5754c8e1c7fa3a58c6671f9199d8710af43878" as Hex;
// flip one bit of the signed hash: same signature, different message
const TAMPERED = (VALID.slice(0, 2) + (VALID[2] === "0" ? "1" : "0") + VALID.slice(3)) as Hex;

const client = createPublicClient({ chain: whitechainSepolia, transport: http(process.env.WHITECHAIN_RPC) });
const call = async (data: Hex) => (await client.call({ to: PRECOMPILE, data })).data ?? "0x";
const isOne = (d: string) => d !== "0x" && BigInt(d) === 1n;

const ok = await call(VALID);
const bad = await call(TAMPERED);
console.log(`valid signature  -> ${ok}`);
console.log(`tampered message -> ${bad}`);
const pass = isOne(ok) && !isOne(bad);
console.log(pass ? "PASS precompile answers correctly" : "FAIL precompile missing or wrong (use the Solidity fallback)");
process.exit(pass ? 0 : 1);
