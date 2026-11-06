import { toHex, type Address } from "viem";
import { AuthError } from "./auth";
import { injectedProvider, type Eip1193 } from "./wallet";
import { buildWalletMessage, walletErrorText } from "./verification";

export { injectedProvider };

type Post = <T>(path: string, body?: unknown) => Promise<T>;

/**
 * Signs in with a wallet that is ALREADY linked to a business (see Verification, signed in with a passkey). It never creates
 * a business. The wallet signs a plain-text message; no money moves and nothing is sent to the chain.
 */
export async function signInWithWallet(p: Eip1193, post: Post, where: { host: string; origin: string }, now = new Date()): Promise<void> {
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as Address[];
  const address = accounts[0];
  if (!address) throw new AuthError("wallet_failed", "");
  const { nonce } = await post<{ nonce: string }>("/auth/siwe/nonce");
  const message = buildWalletMessage({ address, nonce, host: where.host, origin: where.origin, now, statement: "Sign in to your Stenmont business." });
  const signature = (await p.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
  await post("/auth/siwe/verify", { message, signature, intent: "login" });
}

/** Plain words for every way this can stop. The wallet-not-linked case says exactly where to link one. */
export function loginErrorText(e: unknown): string {
  if (e instanceof AuthError) {
    if (e.code === "wallet_not_linked") return "This wallet is not linked to a business yet. Sign in with your passkey first, then link it under Verification. A wallet cannot create a business.";
    if (e.code === "not_activated") return "That business has not finished setting up. Sign in with your passkey to finish.";
    if (e.code === "rate_limited") return "Too many tries. Wait a minute and try again.";
    return walletErrorText({ code: e.code, reason: (e.details as { reason?: string } | undefined)?.reason });
  }
  const err = e as { code?: number | string; name?: string };
  return walletErrorText({ code: String(err?.code ?? ""), name: err?.name }).replace("could not be linked", "could not sign you in");
}
