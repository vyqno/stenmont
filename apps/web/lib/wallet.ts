import { encodeFunctionData, erc20Abi, getTypesForEIP712Domain, numberToHex, type Address, type Hex } from "viem";
import { USDT_ADDRESS, buildReceiveAuth, payNonce, whitechainSepolia } from "@stenmont/shared";

/** The part of an EIP-1193 provider (window.ethereum) we use. */
export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** The browser's wallet, if there is one that can answer requests. Null otherwise, and the option is then hidden. */
export function injectedProvider(win: object): Eip1193 | null {
  const p = (win as { ethereum?: unknown }).ethereum as { request?: unknown } | null | undefined;
  return p && typeof p === "object" && typeof p.request === "function" ? (p as Eip1193) : null;
}

export const WALLET_NETWORK = {
  chainId: numberToHex(whitechainSepolia.id),
  chainName: whitechainSepolia.name,
  nativeCurrency: whitechainSepolia.nativeCurrency,
  rpcUrls: [...whitechainSepolia.rpcUrls.default.http],
  blockExplorerUrls: [whitechainSepolia.blockExplorers.default.url],
};

export type PayAuthArgs = { account: Address; router: Address; value: bigint; validBefore: bigint; invoiceId: Hex; salt: Hex };

/** The exact authorization the passkey path signs (bound to the invoice through its nonce), as the JSON eth_signTypedData_v4 expects. */
export function toTypedDataV4(a: PayAuthArgs): string {
  const typed = buildReceiveAuth({ from: a.account, to: a.router, value: a.value, validAfter: 0n, validBefore: a.validBefore, nonce: payNonce(a.invoiceId, a.salt) });
  return JSON.stringify(
    { ...typed, types: { EIP712Domain: getTypesForEIP712Domain({ domain: typed.domain }), ...typed.types } },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );
}

export class WalletError extends Error {
  constructor(readonly code: "cancelled" | "wallet_network" | "wallet_failed" | "wallet_insufficient") {
    super(code);
  }
}
const isRejection = (e: unknown) => (e as { code?: number })?.code === 4001;

async function ensureNetwork(p: Eip1193) {
  if (String(await p.request({ method: "eth_chainId" })).toLowerCase() === WALLET_NETWORK.chainId) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: WALLET_NETWORK.chainId }] });
  } catch (e) {
    if (isRejection(e)) throw new WalletError("cancelled");
    if ((e as { code?: number })?.code !== 4902) throw new WalletError("wallet_network");
    try {
      await p.request({ method: "wallet_addEthereumChain", params: [WALLET_NETWORK] });
    } catch (e2) {
      throw new WalletError(isRejection(e2) ? "cancelled" : "wallet_network");
    }
  }
}

/** Connects, makes sure the wallet is on the right network, and signs the payment authorization. The relay sends it; the payer pays no network fee. */
export async function signWalletPayment(
  p: Eip1193,
  a: { router: Address; invoiceId: Hex; value: bigint; validBefore: bigint; salt: Hex },
  /** Runs after connecting and before anything is signed, so a short balance never costs the person a pointless prompt. */
  check?: (payer: Address) => Promise<void>,
): Promise<{ payer: Address; signature: Hex }> {
  try {
    const [payer] = (await p.request({ method: "eth_requestAccounts" })) as Address[];
    if (!payer) throw new WalletError("wallet_failed");
    await ensureNetwork(p);
    await check?.(payer);
    const signature = (await p.request({ method: "eth_signTypedData_v4", params: [payer, toTypedDataV4({ ...a, account: payer })] })) as Hex;
    return { payer, signature };
  } catch (e) {
    if (e instanceof WalletError) throw e;
    throw new WalletError(isRejection(e) ? "cancelled" : "wallet_failed");
  }
}

/** USDT held by the paying account, read through the wallet's own connection. */
export async function walletBalance(p: Eip1193, owner: Address): Promise<bigint> {
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  return BigInt((await p.request({ method: "eth_call", params: [{ to: USDT_ADDRESS, data }, "latest"] })) as string);
}

/** Plain words. The button names a wallet because that is what the person is looking for; nothing else does (error messages live in FRIENDLY in pay.ts). */
export const WALLET_COPY = {
  button: "Pay with my own wallet",
  hint: "Already have funds in an app in this browser? Pay from there. You still pay no fees.",
} as const;
