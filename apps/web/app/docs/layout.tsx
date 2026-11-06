import Link from "next/link";
import { Logo } from "../../components/Logo";

const PAGES = [
  { href: "/docs", label: "Quickstart" },
  { href: "/docs/api", label: "API" },
  { href: "/docs/webhooks", label: "Webhooks" },
  { href: "/docs/sdk", label: "SDK and React" },
  { href: "/docs/mcp", label: "MCP" },
  { href: "/docs/x402", label: "x402" },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-xl"><Logo /></Link>
          <span className="text-sm text-muted">Docs</span>
          <nav className="flex flex-1 flex-wrap gap-4 text-sm" aria-label="Docs">
            {PAGES.map((p) => (
              <Link key={p.href} href={p.href} className="text-muted hover:text-foreground">{p.label}</Link>
            ))}
          </nav>
          <Link href="/dashboard/connect" className="rounded bg-navy px-3 py-1.5 text-sm font-medium text-white">Connect your site</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 [&_a]:underline [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:bg-surface [&_code:not(pre_code)]:px-1 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_li]:my-1 [&_p]:my-3 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6">
        {children}
        <p className="mt-12 text-sm text-muted">
          Agents: read <a href="/llms.txt">/llms.txt</a> or the whole reference in <a href="/llms-full.txt">/llms-full.txt</a>. This is the test network: test USDT, no real money.
        </p>
      </main>
    </>
  );
}
