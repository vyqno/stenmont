"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { currentMerchant, signOut, type Merchant } from "../../lib/auth";

// Placeholder shell for Task 4.7: proves the session works. The real dashboard replaces the body.
export default function DashboardClient() {
  const router = useRouter();
  const [merchant, setMerchant] = useState<Merchant | null | undefined>(undefined);

  useEffect(() => {
    currentMerchant().then((m) => (m ? setMerchant(m) : router.replace("/login")));
  }, [router]);

  if (!merchant) return <main className="flex flex-1 items-center justify-center">Loading…</main>;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 data-testid="business-name" className="text-2xl font-semibold">
        {merchant.name}
      </h1>
      <button
        onClick={() => signOut().then(() => router.push("/login"))}
        className="self-start rounded border border-current/30 px-4 py-2 text-sm"
      >
        Sign out
      </button>
    </main>
  );
}
