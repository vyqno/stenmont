import { concat, hexToBytes, keccak256, stringToBytes, type Hex } from "viem";

/**
 * Receipt tree for "close the month". Rules (also in docs/CLOSE-THE-MONTH.md):
 * - leaf = keccak256(utf8("<txHash>|<invoiceId>|<amount>|<kind>")), hex lower-case, amount in base units as a decimal string;
 *   the preimage is always longer than 64 bytes, so a leaf can never be mistaken for an inner node.
 * - leaves are sorted ascending; an inner node is keccak256(min(a,b) ++ max(a,b)) (the OpenZeppelin MerkleProof rule), so a
 *   proof is just the list of siblings, no left/right bits.
 * - an odd node at the end of a level is carried up unchanged (never duplicated).
 * - the empty tree has the zero root.
 */
export type Receipt = { txHash: Hex; invoiceId: Hex; amount: bigint; kind: string };
export type Tree = { root: Hex; leaves: Hex[]; layers: Hex[][] };

const ZERO = `0x${"00".repeat(32)}` as Hex;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

export function leafHash(r: Receipt): Hex {
  if (!HEX32.test(r.txHash) || !HEX32.test(r.invoiceId)) throw new Error("txHash and invoiceId must be 32-byte hex");
  if (r.amount < 0n) throw new Error("amount must not be negative");
  if (!/^[a-z_]{1,32}$/.test(r.kind)) throw new Error("kind must be lower-case letters and underscores");
  return keccak256(stringToBytes(`${r.txHash.toLowerCase()}|${r.invoiceId.toLowerCase()}|${r.amount}|${r.kind}`));
}

const pair = (a: Hex, b: Hex): Hex => keccak256(a.toLowerCase() < b.toLowerCase() ? concat([hexToBytes(a), hexToBytes(b)]) : concat([hexToBytes(b), hexToBytes(a)]));

export function buildTree(input: Hex[]): Tree {
  const leaves = input.map((l) => l.toLowerCase() as Hex).sort();
  if (leaves.length === 0) return { root: ZERO, leaves, layers: [[]] };
  const layers: Hex[][] = [leaves];
  while (layers.at(-1)!.length > 1) {
    const prev = layers.at(-1)!;
    const next: Hex[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pair(prev[i]!, prev[i + 1]!) : prev[i]!);
    layers.push(next);
  }
  return { root: layers.at(-1)![0]!, leaves, layers };
}

/** Siblings from the leaf up; a carried-up odd node contributes no sibling at that level. */
export function proofFor(tree: Tree, index: number): Hex[] {
  if (!Number.isInteger(index) || index < 0 || index >= tree.leaves.length) throw new Error("no such leaf");
  const proof: Hex[] = [];
  let i = index;
  for (const layer of tree.layers.slice(0, -1)) {
    const sibling = layer[i ^ 1];
    if (sibling !== undefined) proof.push(sibling);
    i >>= 1;
  }
  return proof;
}

export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  if (![leaf, root, ...proof].every((h) => HEX32.test(h))) return false;
  let h = leaf.toLowerCase() as Hex;
  for (const s of proof) h = pair(h, s.toLowerCase() as Hex);
  return h === root.toLowerCase();
}
