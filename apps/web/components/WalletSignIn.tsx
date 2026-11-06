"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/auth";
import { injectedProvider, loginErrorText, signInWithWallet } from "../lib/walletLogin";
import type { Eip1193 } from "../lib/wallet";

/** "Use a wallet you already linked". Hidden when this browser has no wallet; the passkey path above is untouched. */
export function WalletSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [provider, setProvider] = useState<Eip1193 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Detected after mount: the server has no wallet, and the button must not flash in on browsers without one.
  useEffect(() => { void Promise.resolve().then(() => setProvider(injectedProvider(window))); }, []);
  if (!provider) return null;

  async function go() {
    if (!provider || busy) return;
    setBusy(true);
    setError("");
    try {
      await signInWithWallet(provider, api.post, { host: location.host, origin: location.origin });
      onSignedIn();
    } catch (e) {
      setError(loginErrorText(e));
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-line pt-5" aria-label="Sign in with a wallet">
      <button type="button" onClick={go} disabled={busy} className="min-h-11 rounded border border-line px-4 py-2 font-medium hover:border-brand disabled:opacity-50" data-testid="wallet-login">
        {busy ? "Waiting for your wallet…" : "Use a wallet you already linked"}
      </button>
      <p className="text-sm text-muted">Only works if you linked a wallet earlier, from Verification, while signed in with your passkey.</p>
      <div aria-live="polite">{error && <p role="alert" data-testid="wallet-login-error" className="text-sm text-danger">{error}</p>}</div>
    </section>
  );
}
