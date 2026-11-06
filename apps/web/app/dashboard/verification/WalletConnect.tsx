"use client";

import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom } from "viem";
import { Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { buildWalletMessage, walletErrorText } from "../../../lib/verification";

type Wallet = { address: string; ensName: string | null; linkedAt: string };
type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown> };

/**
 * For people who already use a wallet: link it as another way to sign in. It never replaces the passkey, which still
 * approves every payment-moving action, and a wallet cannot create a business.
 */
export function WalletConnect() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    api.get<{ wallets: Wallet[] }>("/auth/siwe/wallets").then((r) => setWallets(r.wallets), () => {});
  }, []);
  useEffect(load, [load]);

  async function connect() {
    const provider = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (!provider) return setMessage("No wallet was found in this browser.");
    setBusy(true);
    setMessage("");
    try {
      const client = createWalletClient({ transport: custom(provider) });
      const [address] = await client.requestAddresses();
      if (!address) throw new Error("no account");
      const { nonce } = await api.post<{ nonce: string }>("/auth/siwe/nonce");
      const text = buildWalletMessage({ address, nonce, host: location.host, origin: location.origin });
      const signature = await client.signMessage({ account: address, message: text });
      await api.post("/auth/siwe/verify", { message: text, signature, intent: "link" });
      setMessage("Wallet linked.");
      load();
    } catch (e) {
      const err = e as { code?: string | number; name?: string };
      setMessage(e instanceof AuthError ? walletErrorText({ code: e.code, reason: (e.details as { reason?: string } | undefined)?.reason }) : walletErrorText({ code: String(err.code ?? ""), name: err.name }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(address: string) {
    setMessage("");
    try {
      await api.delete(`/auth/siwe/wallets/${address}`);
      load();
    } catch {
      setMessage("The wallet could not be removed. Try again.");
    }
  }

  return (
    <Card title="Sign in with a wallet">
      <p className="text-sm text-muted">Already use a wallet you trust? Link it as another way to sign in. Your passkey still approves anything that moves money, and a wallet cannot create a business by itself.</p>
      {wallets.length > 0 && (
        <ul className="mt-3 divide-y divide-line" data-testid="wallets">
          {wallets.map((w) => (
            <li key={w.address} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="break-all font-mono text-sm">{w.ensName ? `${w.ensName} · ` : ""}{w.address}</span>
              <button type="button" onClick={() => remove(w.address)} className="rounded border border-line px-3 py-1 text-sm hover:border-danger">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={connect} className="rounded border border-line px-4 py-2 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-50" data-testid="wallet-connect">
          {busy ? "Waiting for your wallet…" : "Connect a wallet"}
        </button>
        {message && <span role="status" data-testid="wallet-message" className="text-sm">{message}</span>}
      </div>
    </Card>
  );
}
