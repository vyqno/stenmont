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
  { href: "/dashboard/agent", label: "Agent" },
  { href: "/dashboard/invoices", label: "Invoices" },
  { href: "/dashboard/subscriptions", label: "Subscriptions" },
  { href: "/dashboard/collections", label: "Collections" },
  { href: "/dashboard/catalog", label: "Catalogue" },
  { href: "/dashboard/financing", label: "Financing" },
  { href: "/dashboard/books", label: "Books" },
  { href: "/dashboard/identity", label: "Identity" },
  { href: "/dashboard/verification", label: "Verification" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [merchant, setMerchant] = useState<Merchant | null>(null);

  useEffect(() => {
    currentMerchant().then((m) => (m ? setMerchant(m) : router.replace("/login")));
  }, [router]);

  if (!merchant) return <main role="status" aria-busy="true" className="flex flex-1 items-center justify-center text-muted">Loading your business…</main>;
  return (
    <MerchantContext.Provider value={merchant}>
      <header className="workspace-header">
        <div className="workspace-navigation">
          <Link href="/dashboard" className="shrink-0 text-xl"><Logo /></Link>
          <nav className="order-3 flex w-full flex-wrap gap-x-5 gap-y-1 text-sm lg:order-none lg:w-auto lg:flex-1" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined} className={`inline-flex min-h-11 items-center ${path === n.href ? "font-medium underline underline-offset-8" : "text-muted hover:text-foreground"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <span data-testid="business-name" title={merchant.name} className="ml-auto max-w-28 truncate text-sm text-muted lg:ml-0">{merchant.name}</span>
          <button onClick={() => signOut().then(() => router.push("/login"))} className="rounded border border-line px-3 py-1 text-sm">
            Sign out
          </button>
        </div>
      </header>
      <main data-workspace="true" className="workspace-canvas">{children}</main>
    </MerchantContext.Provider>
  );
}
