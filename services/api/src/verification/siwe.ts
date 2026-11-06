import { hashMessage, isAddress, recoverAddress, type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage, type SiweMessage } from "viem/siwe";

/** A sign-in message is good for this long after it was issued, whatever it says about its own expiry. */
export const SIWE_TTL_MS = 600_000;
const SKEW_MS = 60_000;

export type SiweExpect = { domain: string; origin: string; chainId: number; now: Date };
export type CheckedSiwe = SiweMessage & { address: Address; nonce: string; issuedAt: Date };
export type SiweCheck =
  | { ok: true; message: CheckedSiwe }
  | { ok: false; reason: "malformed" | "wrong_domain" | "wrong_uri" | "wrong_chain" | "expired" | "not_yet_valid" };

/**
 * Strict EIP-4361 check. The message must be exactly what a canonical writer produces for its own fields (so two parsers
 * cannot read it differently), and must be for THIS site (domain and origin), THIS chain, and be fresh.
 * The nonce is only checked for shape here; the caller consumes it from the database exactly once.
 */
export function checkSiweMessage(raw: string, want: SiweExpect): SiweCheck {
  const m = parseSiweMessage(raw) as Partial<SiweMessage>;
  if (!m.address || !isAddress(m.address, { strict: false }) || !m.nonce || !m.domain || !m.uri || m.version !== "1" || m.chainId === undefined || !m.issuedAt) return { ok: false, reason: "malformed" };
  try {
    if (createSiweMessage(m as SiweMessage) !== raw) return { ok: false, reason: "malformed" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (m.domain !== want.domain) return { ok: false, reason: "wrong_domain" };
  let origin: string;
  try {
    origin = new URL(m.uri).origin;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (origin !== want.origin) return { ok: false, reason: "wrong_uri" };
  if (m.chainId !== want.chainId) return { ok: false, reason: "wrong_chain" };
  const t = want.now.getTime();
  const issued = m.issuedAt.getTime();
  if (Number.isNaN(issued) || (m.expirationTime && Number.isNaN(m.expirationTime.getTime())) || (m.notBefore && Number.isNaN(m.notBefore.getTime()))) return { ok: false, reason: "malformed" };
  if (issued > t + SKEW_MS) return { ok: false, reason: "not_yet_valid" };
  if (m.notBefore && m.notBefore.getTime() > t) return { ok: false, reason: "not_yet_valid" };
  if (t - issued > SIWE_TTL_MS) return { ok: false, reason: "expired" };
  if (m.expirationTime && t >= m.expirationTime.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, message: m as CheckedSiwe };
}

/** What the chain must answer for the wallet check. */
export type WalletChecker = {
  getCode(address: Address): Promise<Hex | undefined>;
  /** ERC-1271 `isValidSignature(hash, signature)`: returns its 4-byte answer. */
  isValidSignature(address: Address, hash: Hex, signature: Hex): Promise<Hex>;
};
const ERC1271_MAGIC = "0x1626ba7e";

/**
 * Did `address` sign `message` (EIP-191)? An ordinary wallet is checked by recovering the signer, with no network call.
 * A smart account (an address with code, for example our passkey account) is asked through ERC-1271 on the chain.
 */
export async function verifyWalletSignature(io: WalletChecker, a: { address: Address; message: string; signature: Hex }): Promise<boolean> {
  const hash = hashMessage(a.message);
  try {
    if ((await recoverAddress({ hash, signature: a.signature })).toLowerCase() === a.address.toLowerCase()) return true;
  } catch {
    /* not a 65-byte ECDSA signature: maybe a contract wallet's own format */
  }
  try {
    const code = await io.getCode(a.address);
    if (!code || code === "0x") return false;
    return (await io.isValidSignature(a.address, hash, a.signature)).toLowerCase() === ERC1271_MAGIC;
  } catch {
    return false;
  }
}
