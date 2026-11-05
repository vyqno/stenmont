"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthError, signUp } from "../../lib/auth";

export default function SignupClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setApiKey((await signUp(name.trim())).apiKey);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (apiKey) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
        <h1 className="text-2xl font-semibold">You&apos;re in</h1>
        <p>This is your API key. It is shown once, so copy it somewhere safe before you continue.</p>
        <code data-testid="api-key" className="break-all rounded border border-current/20 p-3 text-sm">
          {apiKey}
        </code>
        <button onClick={() => router.push("/dashboard")} className="rounded bg-foreground px-4 py-3 font-medium text-background">
          Continue to your dashboard
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
      <h1 className="text-2xl font-semibold">Create your business</h1>
      <p>No password and no code to type. Your device asks for your fingerprint, face or PIN, twice.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Business name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={80}
            autoComplete="organization"
            className="rounded border border-current/30 bg-transparent px-3 py-2 text-base"
          />
        </label>
        <button disabled={busy || name.trim().length < 2} className="rounded bg-foreground px-4 py-3 font-medium text-background disabled:opacity-50">
          {busy ? "Setting up…" : "Continue"}
        </button>
        {error && (
          <p role="status" data-testid="notice" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
      <p className="text-sm">
        Already have a business? <Link href="/login" className="underline">Sign in</Link>
      </p>
    </main>
  );
}
