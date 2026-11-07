"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Logo } from "../../components/Logo";
import { currentMerchant, signOut, type Merchant } from "../../lib/auth";

const MerchantContext = createContext<Merchant | null>(null);
export const useMerchant = () => useContext(MerchantContext)!;

const GROUPS = [
  { label: "Business", items: [{ href: "/dashboard", label: "Overview" }, { href: "/dashboard/invoices", label: "Invoices" }, { href: "/dashboard/subscriptions", label: "Subscriptions" }, { href: "/dashboard/catalog", label: "Catalogue" }, { href: "/dashboard/collections", label: "Collections" }] },
  { label: "Money", items: [{ href: "/dashboard/financing", label: "Financing" }, { href: "/dashboard/books", label: "Books" }] },
  { label: "Trust", items: [{ href: "/dashboard/verification", label: "Verification" }, { href: "/dashboard/identity", label: "Identity" }, { href: "/dashboard/profile", label: "Public profile" }] },
  { label: "Build", items: [{ href: "/dashboard/connect", label: "Connect" }, { href: "/dashboard/agent", label: "Agent" }, { href: "/dashboard/settings", label: "Settings" }] },
] as const;

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    currentMerchant().then((m) => (m ? setMerchant(m) : router.replace("/login")));
  }, [router]);

  if (!merchant) return <main role="status" aria-busy="true" className="dash-loading"><span className="dash-pulse"><Logo /></span></main>;
  const all: { href: string; label: string }[] = GROUPS.reduce<{ href: string; label: string }[]>((acc, g) => acc.concat([...g.items]), []);
  const current = all.find((n) => n.href === path)?.label ?? "Dashboard";
  const links = (
    <>
      {GROUPS.map((g) => (
        <div key={g.label} className="dash-group">
          <p>{g.label}</p>
          {g.items.map((n) => <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}>{n.label}</Link>)}
        </div>
      ))}
    </>
  );
  return (
    <MerchantContext.Provider value={merchant}>
      <div className="dash">
        <aside className="dash-side" aria-label="Dashboard">
          <Link href="/dashboard" className="dash-brand"><Logo /></Link>
          <nav ref={nav} className="dash-nav" aria-label="Dashboard sections">{links}</nav>
          <div className="dash-who">
            <span data-testid="business-name" title={merchant.name}>{merchant.name}</span>
            <button type="button" onClick={() => signOut().then(() => router.push("/login"))}>Sign out</button>
          </div>
        </aside>
        <header className="dash-top">
          <Link href="/dashboard" className="dash-brand"><Logo /></Link>
          <details className="dash-menu"><summary>{current}</summary><div>{links}<div className="dash-who"><span title={merchant.name}>{merchant.name}</span><button type="button" onClick={() => signOut().then(() => router.push("/login"))}>Sign out</button></div></div></details>
        </header>
        <main data-workspace="true" className="dash-main"><div key={path} className="dash-page">{children}</div></main>
      </div>
    </MerchantContext.Provider>
  );
}
