import Link from "next/link";
import { Logo } from "../components/Logo";
import { SceneChip } from "../components/brand/SceneChip";
import { RecordDiagram } from "../components/brand/RecordDiagram";
import { ConnectPreview } from "../components/brand/ProductCards";
import { GreyPanel } from "../components/brand/Surface";
import { FeatureExplorer } from "../components/brand/FeatureExplorer";
import { DeveloperConsole } from "../components/brand/DeveloperConsole";
import "./marketing.css";

export default function Home() {
  return <div className="marketing">
    <a href="#content" className="skip-link">Skip to content</a>
    <header className="marketing-header"><Link href="/" aria-label="Stenmont home" className="text-2xl"><Logo /></Link><nav aria-label="Main navigation"><a href="#business-kit">Product</a><a href="#how-it-works">How it works</a><Link href="/docs">Developers</Link><Link href="/login">Sign in</Link><Link href="/signup" className="action ink">Get started <span aria-hidden="true">↗</span></Link></nav></header>
    <main id="content">
      <section className="hero marketing-container"><p className="eyebrow">The agentic business kit.</p><h1 aria-label="Get paid the day you invoice."><span>Get paid <SceneChip kind="receipt" /> the day</span>{" "}<span>you <SceneChip kind="invoice" /> invoice.</span></h1><div className="hero-bottom"><div><p className="lede">For suppliers, agencies and exporters who bill other businesses.</p><div className="actions"><Link href="/signup" className="action ink">Create your business <span aria-hidden="true">↗</span></Link><Link href="/docs" className="text-link">Explore the docs <span aria-hidden="true">↗</span></Link></div></div><p className="hero-note">Turn an unpaid invoice into a receivable investors can fund. Financing depends on investor funding and eligibility; same-day payment is not guaranteed. Currently on the test network.</p></div></section>
      <section id="business-kit" className="marketing-container product-section"><div className="section-head"><p className="eyebrow">01 / The business kit</p><h2>One place for the work<br />after the work.</h2></div><FeatureExplorer /></section>
      <section id="how-it-works" className="solution-band"><div className="marketing-container"><p className="eyebrow">02 / Built around your business</p><h2>Invoices become possibilities.</h2><div className="solution-grid">{[
        { title:"Get paid across borders", body:"A named business, a clear amount and a USDT payment record. Payers bring their own funds.", kind:"globe" as const },
        { title:"Put receivables to work", body:"Keep the invoice, the financing claim and the settlement connected. Funding and terms are explicit.", kind:"layers" as const },
        { title:"Give every party a record", body:"Business, buyer, investor and agent. Different permissions, one traceable financial workflow.", kind:"network" as const },
      ].map(card=><article key={card.title} className="solution-card"><h3>{card.title}<span aria-hidden="true">↗</span></h3><p>{card.body}</p><RecordDiagram kind={card.kind} /><small>Concept diagram · not a live transaction</small></article>)}</div></div></section>
      <section className="marketing-container connect-section"><div className="connect-copy"><p className="eyebrow">03 / Bring your own business</p><h2>Your site.<br />Already in the picture.</h2><p>Connect the site you have. A prompt, API or SDK gets the integration started; four checks show what still needs attention.</p><div className="scene-pair"><SceneChip kind="store" /><SceneChip kind="passkey" /></div><Link href="/dashboard/connect" className="text-link">Connect your site <span aria-hidden="true">↗</span></Link></div><GreyPanel><ConnectPreview /></GreyPanel></section>
      <section className="editorial marketing-container"><p className="eyebrow">A record worth keeping.</p><h2>Work delivered.<br />Invoice sent.<br /><span>Next chapter, open.</span> <SceneChip kind="certificate" /></h2><p>Payments are the start. Build a business with connected records, clear terms and people in control.</p></section>
      <section className="developer-band"><div className="marketing-container"><div className="developer-head"><div><p className="eyebrow">04 / For developers and agents</p><h2>A small integration.<br />A working business kit.</h2></div><Link href="/docs" className="action paper">Read the documentation <span aria-hidden="true">↗</span></Link></div><DeveloperConsole /><div className="developer-links">{[["API", "/docs/api", "Create invoices and receive signed events."],["SDK + React", "/docs/sdk", "Connect checkout to your existing site."],["MCP + OAuth", "/docs/mcp", "Give agents explicit, scoped access."],["Agent reference", "/llms-full.txt", "The complete reference in plain text."]].map(([title,href,body])=><Link href={href!} key={title}><span>{title}<b aria-hidden="true">↗</b></span><p>{body}</p></Link>)}</div></div></section>
      <section className="closing marketing-container"><p className="eyebrow">Start with one invoice.</p><h2>Make your next<br />move a little clearer.</h2><Link href="/signup" className="action ink">Try the test network <span aria-hidden="true">↗</span></Link></section>
    </main>
    <footer className="marketing-container marketing-footer"><div><Link href="/" className="text-3xl"><Logo /></Link><p>The agentic business kit.</p></div><nav aria-label="Footer"><Link href="/docs">Documentation</Link><Link href="/login">Sign in</Link><a href="/llms.txt">llms.txt</a></nav><p className="footer-note">Whitechain test network · Test USDT only · No real money.<br />No custody or payment guarantee. Payers bring their own USDT. Transactions are public; financing is a testnet demonstration. Business payments are settled in seconds onchain after confirmation.</p></footer>
  </div>;
}
