import { pageMetadata } from "../lib/seo";
import Link from "next/link";
import { Logo } from "../components/Logo";
import { SceneChip } from "../components/brand/SceneChip";
import { RecordDiagram } from "../components/brand/RecordDiagram";
import { ConnectPreview } from "../components/brand/ProductCards";
import { GreyPanel } from "../components/brand/Surface";
import { FeatureExplorer } from "../components/brand/FeatureExplorer";
import { DeveloperConsole } from "../components/brand/DeveloperConsole";
import "./marketing.css";

export const metadata = pageMetadata("/");

export default function Home() {
  return <div className="marketing">
    <a href="#content" className="skip-link">Skip to content</a>
    <header className="marketing-header"><Link href="/" aria-label="Stenmont home" className="text-2xl"><Logo /></Link><details className="mobile-menu"><summary>Menu</summary><nav aria-label="Mobile navigation"><a href="#business-kit">Product</a><a href="#how-it-works">How it works</a><Link href="/docs">Developers</Link><Link href="/login">Sign in</Link></nav></details><nav aria-label="Main navigation"><a href="#business-kit">Product</a><a href="#how-it-works">How it works</a><Link href="/docs">Developers</Link><Link href="/login">Sign in</Link><Link href="/signup" className="action ink">Get started <span aria-hidden="true">↗</span></Link></nav></header>
    <main id="content">
      <section className="hero marketing-container"><p className="eyebrow">The agentic business kit.</p><h1 aria-label="Your business, on stablecoins."><span>Your <SceneChip kind="store" /> business,</span>{" "}<span>on <SceneChip kind="receipt" /> stablecoins.</span></h1><div className="hero-bottom"><div><p className="lede">Sell, get paid, close the books and get funded. One commerce and finance platform, with an agent to connect the work.</p><div className="actions"><Link href="/signup" className="action ink">Create your business <span aria-hidden="true">↗</span></Link><Link href="/docs" className="text-link">Explore the docs <span aria-hidden="true">↗</span></Link></div></div><p className="hero-note">Storefronts and USDT checkout run on the Whitechain test network. Capital is a financing demonstration: eligibility, human approval and investor funding apply. Funding is not guaranteed.</p></div></section>
      <section id="business-kit" className="marketing-container product-section"><div className="section-head"><p className="eyebrow">01 / The business kit</p><h2>One platform.<br />The whole business loop.</h2></div><FeatureExplorer /></section>
      <section id="how-it-works" className="solution-band"><div className="marketing-container"><p className="eyebrow">02 / Built around your business</p><h2>From a sale to the next decision.</h2><div className="solution-grid">{[
        { title:"Sell where your business is", body:"Publish a hosted storefront or connect your existing site. Keep products, checkout and payment records together.", kind:"globe" as const },
        { title:"Keep the books connected", body:"Reconcile receipts, refunds and financing records. Export a service-signed snapshot with verifiable line proofs; onchain anchoring is not enabled.", kind:"layers" as const },
        { title:"Give agents a clear role", body:"Let an agent install checkout and prepare operating steps. Scope its access; people approve consequential money actions.", kind:"network" as const },
      ].map(card=><article key={card.title} className="solution-card"><h3>{card.title}<span aria-hidden="true">↗</span></h3><p>{card.body}</p><RecordDiagram kind={card.kind} /><small>Concept diagram · not a live transaction</small></article>)}</div></div></section>
      <section className="marketing-container connect-section"><div className="connect-copy"><p className="eyebrow">03 / Connect and operate</p><h2>Your business.<br />Your financial agent.</h2><p>Start a storefront or bring the site you have. A coding agent installs checkout through Connect; scoped tools help it read records and prepare follow-ups. Live finance chat is still being verified.</p><div className="scene-pair"><SceneChip kind="store" /><SceneChip kind="passkey" /></div><Link href="/dashboard/connect" className="text-link">Connect your site <span aria-hidden="true">↗</span></Link></div><GreyPanel><ConnectPreview /></GreyPanel></section>
      <section className="editorial marketing-container"><p className="eyebrow">A record worth keeping.</p><h2>A sale recorded.<br />The books connected.<br /><span>Your next move, clearer.</span> <SceneChip kind="certificate" /></h2><p>See the sale, the payment and the records together. Explore Capital when eligible receivables could fund your next move; keep the terms and approvals in view.</p></section>
      <section className="developer-band"><div className="marketing-container"><div className="developer-head"><div><p className="eyebrow">04 / For developers and agents</p><h2>A business platform.<br />An interface for builders.</h2></div><Link href="/docs" className="action paper">Read the documentation <span aria-hidden="true">↗</span></Link></div><DeveloperConsole /><div className="developer-links">{[["API", "/docs/api", "Connect catalogue, checkout and signed events."],["SDK + React", "/docs/sdk", "Use the local checkout SDK and React components."],["MCP + OAuth", "/docs/mcp", "Give agents explicit, scoped access."],["Agent reference", "/llms-full.txt", "The complete reference in plain text."]].map(([title,href,body])=><Link href={href!} key={title}><span>{title}<b aria-hidden="true">↗</b></span><p>{body}</p></Link>)}</div></div></section>
      <section className="closing marketing-container"><p className="eyebrow">Start with your business.</p><h2>Sell today.<br />Build what comes next.</h2><Link href="/signup" className="action ink">Try the test network <span aria-hidden="true">↗</span></Link></section>
    </main>
    <footer className="marketing-container marketing-footer"><div><Link href="/" className="text-3xl"><Logo /></Link><p>The agentic business kit.</p></div><nav aria-label="Footer"><Link href="/docs">Documentation</Link><Link href="/login">Sign in</Link><a href="/llms.txt">llms.txt</a></nav><p className="footer-note">Whitechain test network · Test USDT only · No real money.<br />Payers bring their own USDT. Stenmont does not supply payment funds or convert currencies. Transactions are public; Capital is a testnet demonstration with no funding or payment guarantee. Business payments are settled in seconds onchain after confirmation.</p></footer>
  </div>;
}
