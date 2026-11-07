import { pageMetadata } from "../lib/seo";
import Link from "next/link";
import { Logo } from "../components/Logo";
import { HeroHeadline } from "../components/landing/HeroHeadline";
import { PinnedStory } from "../components/landing/PinnedStory";
import { Migrate } from "../components/landing/Migrate";
import { DevShowcase } from "../components/landing/DevShowcase";
import "./marketing.css";
import "./landing-story.css";

export const metadata = pageMetadata("/");

const FOOT = [
  { head: "Product", links: [["How it works", "/#how-it-works"], ["Developers", "/#developers"], ["Create your business", "/signup"], ["Sign in", "/login"]] },
  { head: "Build", links: [["Documentation", "/docs"], ["API reference", "/docs/api"], ["SDK and React", "/docs/sdk"], ["MCP and OAuth", "/docs/mcp"], ["x402 payments", "/docs/x402"]] },
  { head: "For agents", links: [["llms.txt", "/llms.txt"], ["Full reference", "/llms-full.txt"], ["Webhooks", "/docs/webhooks"], ["FAQ", "/docs/faq"]] },
] as const;

export default function Home() {
  return <div className="marketing v2 v3">
    <a href="#content" className="skip-link">Skip to content</a>
    <header className="v3-bar" id="bar">
      <div className="v3-bar-inner">
        <Link href="/" aria-label="Stenmont home" className="v2-brand"><Logo /></Link>
        <nav aria-label="Main navigation" className="v3-links"><a href="#how-it-works">How it works</a><a href="#developers">Developers</a><Link href="/docs">Docs</Link><Link href="/login">Sign in</Link></nav>
        <div className="v3-right">
          <Link href="/signup" className="v3-cta">Get started</Link>
          <details className="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation"><a href="#how-it-works">How it works</a><a href="#developers">Developers</a><Link href="/docs">Docs</Link><Link href="/login">Sign in</Link><Link href="/signup">Get started</Link></nav></details>
        </div>
      </div>
    </header>
    <main id="content">
      <section className="v3-hero hl-hero"><div className="v2-wrap">
        <HeroHeadline />
        <div className="hl-under">
          <p className="v2-lede v2-rv">Sell, get paid, close the books and get funded. One commerce and finance platform, with an agent to connect the work.</p>
          <div>
            <div className="v2-actions v2-rv"><Link href="/signup" className="v3-btn v3-btn-blue">Create your business</Link><Link href="/docs" className="v3-btn v3-btn-line">Explore the docs</Link></div>
            <p className="v2-note v2-rv">Storefronts and USDT checkout run on the Whitechain test network. Capital is a financing demonstration: eligibility, human approval and investor funding apply. Funding is not guaranteed.</p>
          </div>
        </div>
      </div></section>

      <PinnedStory />

      <Migrate />

      <DevShowcase />

      <section className="v3-closing"><div className="v2-wrap v3-closing-grid">
        <div className="closing-copy">
          <p className="v2-eyebrow v2-rv">Start with your business</p>
          <h2 className="v2-h v2-title">Sell today. <span className="v2-blue">Build what comes next.</span></h2>
          <Link href="/signup" className="v3-btn v3-btn-blue v2-rv">Try the test network</Link>
        </div>
        <div className="closing-art" aria-hidden="true"><img src="/art/dither-mountain.png" alt="" width="2400" height="1000" loading="lazy" /></div>
      </div></section>
    </main>
    <footer className="v3-foot">
      <div className="v2-wrap">
        <div className="v3-foot-top">
          <div className="v3-foot-cols">{FOOT.map((c) => <nav key={c.head} aria-label={c.head}><h3>{c.head}</h3><ul>{c.links.map(([label, href]) => <li key={label}>{href.startsWith("/llms") ? <a href={href}>{label}</a> : <Link href={href}>{label}</Link>}</li>)}</ul></nav>)}</div>
        </div>
        <div className="v3-foot-base"><div className="v3-foot-legal"><p>Whitechain test network · Test USDT only · No real money.</p><p>Payers bring their own USDT. Stenmont does not supply payment funds or convert currencies. Transactions are public; Capital is a testnet demonstration with no funding or payment guarantee. Business payments are settled in seconds onchain after confirmation.</p></div>
          <div className="v3-foot-brand"><Link href="/" className="v2-brand"><Logo /></Link><p>The agentic business kit.</p></div>
        </div>
      </div>
    </footer>
  </div>;
}
