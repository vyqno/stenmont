"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthError, signIn } from "../../lib/auth";
import { safeNext } from "../../lib/oauth";

export default function LoginClient() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
      router.push(safeNext(location.search) ?? "/dashboard");
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p>Use the fingerprint, face or PIN you set up for your business.</p>
      <button onClick={submit} disabled={busy} className="rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-50">
        {busy ? "Waiting for your device…" : "Sign in with your device"}
      </button>
      {error && (
        <p role="status" data-testid="notice" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <p className="text-sm">
        New here? <Link href="/signup" className="underline">Create your business</Link>
      </p>
    </main>
  );
}
