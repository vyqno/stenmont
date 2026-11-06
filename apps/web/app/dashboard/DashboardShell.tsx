"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { Logo } from "../../components/Logo";
import { currentMerchant, signOut, type Merchant } from "../../lib/auth";

const MerchantContext = createContext<Merchant | null>(null);
export const useMerchant = () => useContext(MerchantContext)!;

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/connect", label: "Connect" },
  { href: "/dashboard/invoices", label: "Invoices" },
  { href: "/dashboard/subscriptions", label: "Subscriptions" },
  { href: "/dashboard/catalog", label: "Catalogue" },
  { href: "/dashboard/financing", label: "Financing" },
  { href: "/dashboard/identity", label: "Identity" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [merchant, setMerchant] = useState<Merchant | null>(null);

  useEffect(() => {
    currentMerchant().then((m) => (m ? setMerchant(m) : router.replace("/login")));
  }, [router]);

  if (!merchant) return <main className="flex flex-1 items-center justify-center text-muted">Loading…</main>;
  return (
    <MerchantContext.Provider value={merchant}>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="text-xl"><Logo /></Link>
          <nav className="flex flex-1 flex-wrap gap-4 text-sm" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined} className={path === n.href ? "font-medium underline underline-offset-8" : "text-muted hover:text-foreground"}>
                {n.label}
              </Link>
            ))}
          </nav>
          <span data-testid="business-name" className="text-sm text-muted">{merchant.name}</span>
          <button onClick={() => signOut().then(() => router.push("/login"))} className="rounded border border-line px-3 py-1 text-sm">
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </MerchantContext.Provider>
  );
}
