import type { Hex } from "viem";
import { toUnits } from "@stenmont/shared";
import { b64urlToHex, type Reputation } from "./financing";
import { createPasskey, loadPasskey, signDigest, type StoredPasskey } from "./passkey";
import { ZERO_SALT, apiBase } from "./pay";

export type Claim = {
  invoiceId: string;
  contractVersion?: "v1" | "v2";
  routerAddress?: string;
  claimAddress?: string;
  status: string;
  face: string;
  price: string;
  discount: string;
  discountBps: number;
  reserve: string;
  advance: string;
  yieldToDueDate: string;
  annualisedYield: string;
  dueDate: string;
  fundBy: string;
  merchant: { name: string; reputation: Reputation };
  payer: { reputation: Reputation };
};

export class InvestError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}

/** Public API call (no login). Throws InvestError with the server's error code. */
export async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiBase(location.hostname) + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, unknown>;
  if (!res.ok) throw new InvestError(json.error?.code ?? "error", json.error?.message);
  return json as T;
}

export type AccountInfo = { address: Hex; balance: string };
export const lookupAccount = (k: StoredPasskey) => call<AccountInfo>("POST", "/relay/account", { qx: k.qx, qy: k.qy, salt: ZERO_SALT });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The investor's passkey account: reuse the one in this browser or make one (one prompt). */
export async function ensureAccount(): Promise<{ key: StoredPasskey; info: AccountInfo }> {
  const key = loadPasskey() ?? (await createPasskey());
  return { key, info: await lookupAccount(key) };
}

/** Funding always comes from the investor's own USDT; no environment may request platform funds. */
export function ensureFunded(info: AccountInfo, need: bigint): AccountInfo {
  if (toUnits(info.balance) < need) throw new InvestError("insufficient");
  return info;
}

type FundRequest = { price: string; authorization: { validBefore: string; salt: Hex }; challenge: string };

/** Asks whether this account may invest in this claim. True = allowed; false = needs the person check first. */
export async function isAllowed(invoiceId: string, account: Hex): Promise<boolean> {
  try {
    await call<FundRequest>("POST", `/invest/claims/${invoiceId}/fund-request`, { account });
    return true;
  } catch (e) {
    if (e instanceof InvestError && e.code === "not_allowed") return false;
    throw e;
  }
}

/** Sign the purchase with the investor passkey and send it. Returns the transaction hash. */
export async function fund(invoiceId: string, key: StoredPasskey, info: AccountInfo, onStep: (s: string) => void): Promise<string> {
  const req = await call<FundRequest>("POST", `/invest/claims/${invoiceId}/fund-request`, { account: info.address });
  info = ensureFunded(info, toUnits(req.price));
  onStep("Confirm on your device…");
  let signature: Hex;
  try {
    signature = await signDigest(key, b64urlToHex(req.challenge));
  } catch (e) {
    if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) throw new InvestError("cancelled");
    if (e instanceof Error && e.message === "cancelled") throw new InvestError("cancelled");
    throw e;
  }
  onStep("Sending your purchase…");
  const payload = {
    account: info.address,
    salt: req.authorization.salt,
    validBefore: req.authorization.validBefore,
    signature,
    accountDetails: { qx: key.qx, qy: key.qy, salt: ZERO_SALT },
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return (await call<{ txHash: string }>("POST", `/invest/claims/${invoiceId}/fund`, payload)).txHash;
    } catch (e) {
      if (!(e instanceof InvestError && e.code === "busy" && attempt < 3)) throw e;
      await sleep(2_000 * (attempt + 1));
    }
  }
}

/** Bind World approval to the claim being purchased, never the changing creation default. */
export function investorApprovalTarget(claim: { contractVersion?: string }): "v1" | "v2" {
  if (!claim.contractVersion || claim.contractVersion === "v1") return "v1";
  if (claim.contractVersion === "v2") return "v2";
  throw new InvestError("not_available");
}
