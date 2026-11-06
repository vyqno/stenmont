"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES = [
  ["/docs", "Quickstart"], ["/docs/api", "API reference"], ["/docs/webhooks", "Webhooks"],
  ["/docs/sdk", "SDK and React"], ["/docs/mcp", "MCP and OAuth"], ["/docs/x402", "x402 payments"], ["/docs/faq", "FAQ"],
];
export function DocsNav() {
  const path = usePathname();
  return <nav aria-label="Documentation sections" className="docs-navigation">{PAGES.map(([href, label]) => <Link href={href!} key={href} aria-current={path === href ? "page" : undefined}>{label}</Link>)}</nav>;
}
