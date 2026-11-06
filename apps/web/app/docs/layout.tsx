import Link from "next/link";
import { Logo } from "../../components/Logo";
import { DocsNav, DocsPills } from "./DocsNav";
import { DocsTools } from "./DocsTools";
import { DocsToc } from "./DocsToc";
import "./docs.css";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs-shell">
      <a href="#docs-content" className="skip-link">Skip to documentation</a>
      <header className="docs-header">
        <Link href="/" className="v2-brand" aria-label="Stenmont home"><Logo /></Link>
        <DocsPills />
        <span className="docs-label">Test network</span>
        <Link href="/dashboard/connect" className="v2-btn v2-btn-blue docs-connect"><span>Connect your site</span></Link>
      </header>
      <div className="docs-grid">
        <aside className="docs-sidebar"><p className="docs-kicker">Build with Stenmont</p><DocsNav /><div className="docs-sidebar-note"><p>For people and agents. One reference, with the same tested examples.</p><a href="/llms-full.txt">Read the plain text ↗</a><p>Before you build: use test credentials, keep API keys on your server, and confirm payments using signed webhooks.</p><Link href="/docs/webhooks">Webhook verification ↗</Link></div></aside>
        <div className="docs-body"><DocsTools /><main id="docs-content" className="docs-prose">{children}<p className="docs-network-note">This is the test network: test USDT, no real money. Agents can read <a href="/llms.txt">/llms.txt</a> or the complete <a href="/llms-full.txt">/llms-full.txt</a> reference.</p></main></div>
        <aside className="docs-rail" aria-label="On this page"><DocsToc /></aside>
      </div>
    </div>
  );
}
