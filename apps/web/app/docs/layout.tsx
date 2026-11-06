import Link from "next/link";
import { Logo } from "../../components/Logo";
import { DocsNav } from "./DocsNav";
import { DocsTools } from "./DocsTools";
import "./docs.css";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-shell">
      <a href="#docs-content" className="skip-link">Skip to documentation</a>
      <header className="docs-header"><Link href="/" className="text-2xl" aria-label="Stenmont home"><Logo /></Link><span className="docs-label">Documentation</span><Link href="/dashboard/connect" className="docs-connect">Connect your site <span aria-hidden="true">↗</span></Link></header>
      <div className="docs-tabs"><nav aria-label="Documentation resources"><Link href="/docs" aria-current="page">Guides &amp; reference</Link><a href="/llms.txt">Agent index</a><a href="/llms-full.txt">Full reference</a></nav><span>Test network</span></div>
      <div className="docs-grid">
        <aside className="docs-sidebar"><p className="text-xs font-semibold uppercase tracking-wider">Build with Stenmont</p><DocsNav /><div className="docs-sidebar-note"><p>For people and agents.</p><p>One reference, with the same tested examples.</p><a href="/llms-full.txt">Read the plain text ↗</a></div></aside>
        <div className="docs-body"><DocsTools /><main id="docs-content" className="docs-prose">{children}<p className="docs-network-note">This is the test network: test USDT, no real money. Agents can read <a href="/llms.txt">/llms.txt</a> or the complete <a href="/llms-full.txt">/llms-full.txt</a> reference.</p></main></div>
        <aside className="docs-rail" aria-label="Reference notes"><p className="font-semibold">Before you build</p><p>Use test credentials. Keep API keys on your server.</p><p>Confirm payments using signed webhooks.</p><Link href="/docs/webhooks">Webhook verification ↗</Link><a href="/llms-full.txt">Full agent reference ↗</a></aside>
      </div>
    </div>
  );
}
