import { pageMetadata } from "../lib/seo";
import Link from "next/link";
import { Logo } from "../components/Logo";
import { ConnectPreview } from "../components/brand/ProductCards";
import { GreyPanel } from "../components/brand/Surface";
import { FeatureExplorer } from "../components/brand/FeatureExplorer";
import { DeveloperConsole } from "../components/brand/DeveloperConsole";
import "./marketing.css";

export const metadata = pageMetadata("/");

const LOOP = [
  { n: "01", title: "Sell where your business is", body: "Publish a hosted storefront or connect your existing site. Keep products, checkout and payment records together." },
  { n: "02", title: "Keep the books connected", body: "Reconcile receipts, refunds and financing records. Export a service-signed snapshot with verifiable line proofs; onchain anchoring is not enabled." },
  { n: "03", title: "Give agents a clear role", body: "Let an agent install checkout and prepare operating steps. Scope its access; people approve consequential money actions." },
];

export default function Home() {
  return <div className="marketing v2">
    <a href="#content" className="skip-link">Skip to content</a>
    <header className="v2-nav"><div className="v2-nav-inner">
      <Link href="/" aria-label="Stenmont home" className="v2-brand"><Logo /></Link>
      <nav aria-label="Main navigation" className="v2-links"><a href="#business-kit">Product</a><a href="#how-it-works">How it works</a><Link href="/docs">Developers</Link><Link href="/login">Sign in</Link></nav>
      <Link href="/signup" className="v2-btn v2-btn-blue v2-nav-cta"><span>Get started</span></Link>
      <details className="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation"><a href="#business-kit">Product</a><a href="#how-it-works">How it works</a><Link href="/docs">Developers</Link><Link href="/login">Sign in</Link><Link href="/signup">Get started</Link></nav></details>
    </div></header>
    <main id="content">
      <section className="v2-hero"><div className="v2-glow" aria-hidden="true" /><div className="v2-wrap v2-hero-grid">
        <div className="v2-hero-copy">
          <p className="v2-pill">The agentic business kit</p>
          <h1 className="v2-h v2-display" aria-label="Your business, on stablecoins.">Your business, <span className="v2-blue">on stablecoins.</span></h1>
          <p className="v2-lede v2-rv">Sell, get paid, close the books and get funded. One commerce and finance platform, with an agent to connect the work.</p>
          <div className="v2-actions v2-rv"><Link href="/signup" className="v2-btn v2-btn-blue"><span>Create your business</span></Link><Link href="/docs" className="v2-btn v2-btn-line"><span>Explore the docs</span></Link></div>
          <p className="v2-note v2-rv">Storefronts and USDT checkout run on the Whitechain test network. Capital is a financing demonstration: eligibility, human approval and investor funding apply. Funding is not guaranteed.</p>
        </div>
        <div className="v2-hero-art" aria-hidden="true"><img src="/art/mountain-dither.png" alt="" width="1600" height="900" /></div>
      </div></section>

      <section id="business-kit" className="v2-wrap v2-section"><p className="v2-eyebrow v2-rv">01 · The business kit</p><h2 className="v2-h v2-title">One platform. <span className="v2-blue">The whole business loop.</span></h2><div className="v2-rv"><FeatureExplorer /></div></section>

      <section id="how-it-works" className="v2-section v2-tint"><div className="v2-wrap">
        <p className="v2-eyebrow v2-rv">02 · Built around your business</p><h2 className="v2-h v2-title">From a sale to <span className="v2-blue">the next decision.</span></h2>
        <div className="v2-cards v2-group">{LOOP.map(c => <article key={c.n} className="v2-card v2-rv"><span className="v2-num">{c.n}</span><h3>{c.title}</h3><p>{c.body}</p></article>)}</div>
      </div></section>

      <section className="v2-wrap v2-section v2-connect"><div className="v2-connect-copy">
        <p className="v2-eyebrow v2-rv">03 · Connect and operate</p><h2 className="v2-h v2-title">Your business. <span className="v2-blue">Your financial agent.</span></h2>
        <p className="v2-lede v2-rv">Start a storefront or bring the site you have. A coding agent installs checkout through Connect; scoped tools help it read records and prepare follow-ups. Live finance chat is still being verified.</p>
        <Link href="/dashboard/connect" className="v2-btn v2-btn-line v2-rv"><span>Connect your site</span></Link>
      </div><GreyPanel className="v2-stage v2-rv"><ConnectPreview /></GreyPanel></section>

      <section className="v2-wrap v2-statement"><p className="v2-eyebrow v2-rv">A record worth keeping</p>
        <p className="v2-h v2-quote">A sale recorded. The books connected. <span className="v2-blue">Your next move, clearer.</span></p>
        <p className="v2-lede v2-rv">See the sale, the payment and the records together. Explore Capital when eligible receivables could fund your next move; keep the terms and approvals in view.</p>
      </section>

      <section className="v2-dev"><div className="v2-wrap">
        <div className="v2-dev-head"><div><p className="v2-eyebrow v2-eyebrow-light">04 · For developers and agents</p><h2 className="v2-h v2-title v2-title-light">A business platform. <span className="v2-blue-soft">An interface for builders.</span></h2></div><Link href="/docs" className="v2-btn v2-btn-paper"><span>Read the documentation</span></Link></div>
        <DeveloperConsole />
        <div className="v2-dev-links v2-group">{[["API", "/docs/api", "Connect catalogue, checkout and signed events."],["SDK + React", "/docs/sdk", "Use the local checkout SDK and React components."],["MCP + OAuth", "/docs/mcp", "Give agents explicit, scoped access."],["Agent reference", "/llms-full.txt", "The complete reference in plain text."]].map(([title,href,body])=><Link className="v2-rv" href={href!} key={title}><span>{title}</span><p>{body}</p></Link>)}</div>
      </div></section>

      <section className="v2-wrap v2-closing"><div className="v2-glow v2-glow-c" aria-hidden="true" /><p className="v2-eyebrow v2-rv">Start with your business</p><h2 className="v2-h v2-title">Sell today. <span className="v2-blue">Build what comes next.</span></h2><Link href="/signup" className="v2-btn v2-btn-blue v2-rv"><span>Try the test network</span></Link></section>
    </main>
    <footer className="v2-wrap v2-footer"><div><Link href="/" className="v2-brand"><Logo /></Link><p>The agentic business kit.</p></div><nav aria-label="Footer"><Link href="/docs">Documentation</Link><Link href="/login">Sign in</Link><a href="/llms.txt">llms.txt</a></nav><p className="v2-footnote">Whitechain test network · Test USDT only · No real money.<br />Payers bring their own USDT. Stenmont does not supply payment funds or convert currencies. Transactions are public; Capital is a testnet demonstration with no funding or payment guarantee. Business payments are settled in seconds onchain after confirmation.</p></footer>
  </div>;
}
