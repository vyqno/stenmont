"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const PAGES = [
  ["/docs", "Quickstart"], ["/docs/api", "API reference"], ["/docs/webhooks", "Webhooks"],
  ["/docs/sdk", "SDK and React"], ["/docs/mcp", "MCP and OAuth"], ["/docs/x402", "x402 payments"], ["/docs/faq", "FAQ"],
];
export function DocsNav() {
  const path = usePathname();
  const [q, setQ] = useState("");
  const shown = PAGES.filter(([, label]) => label.toLowerCase().includes(q.trim().toLowerCase()));
  return <div className="docs-navwrap"><label className="docs-search"><span className="sr-only">Search the documentation</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></label><nav aria-label="Documentation sections" className="docs-navigation">{shown.length ? shown.map(([href, label]) => <Link href={href!} key={href} aria-current={path === href ? "page" : undefined}>{label}</Link>) : <p className="docs-none">No page matches.</p>}</nav></div>;
}

/** Top pills: "Docs" is current on every guide page except the API reference. */
export function DocsPills() {
  const path = usePathname();
  const api = path === "/docs/api";
  return <nav aria-label="Documentation resources" className="docs-pills"><Link href="/docs" aria-current={!api ? "page" : undefined}>Docs</Link><Link href="/docs/api" aria-current={api ? "page" : undefined}>API reference</Link><a href="/llms.txt">Agent index</a><a href="/llms-full.txt">Full reference</a></nav>;
}
