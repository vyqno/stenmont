import Link from "next/link";
import { Logo } from "../components/Logo";
import { BrandScene } from "../components/BrandScene";
import "./marketing.css";

export default function Home() {
  return (
    <div className="marketing">
      <a href="#content" className="skip-link">Skip to content</a>
      <header className="marketing-header">
        <Link href="/" aria-label="Stenmont home" className="text-2xl"><Logo /></Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a><Link href="/docs">Docs</Link><Link href="/login">Sign in</Link>
          <Link href="/signup" className="action ink">Start building <span aria-hidden="true">↗</span></Link>
        </nav>
      </header>
      <main id="content">
        <section className="hero marketing-container">
          <p className="eyebrow">The agentic business kit.</p>
          <h1 aria-label="Get paid the day you invoice.">
            <span>Get paid <BrandScene scene="dispatch" className="hero-chip" /> the day</span>{" "}
            <span>you <BrandScene scene="invoice" className="hero-chip" /> invoice.</span>
          </h1>
          <div className="hero-bottom">
            <div>
              <p className="lede">For suppliers, agencies and exporters who bill other businesses.</p>
              <p className="text-muted mt-4 max-w-xl">Turn an unpaid invoice into a receivable investors can fund. Bring payments, records and your agent into one working kit.</p>
              <div className="actions"><Link href="/signup" className="action accent">Create your business <span aria-hidden="true">↗</span></Link><Link href="/docs" className="action secondary">Read the docs</Link></div>
            </div>
            <div className="hero-note">
              <p className="eyebrow">Built on a payment record</p>
              <p>Financing depends on investor funding and eligibility; same-day payment is not guaranteed.</p>
              <p className="text-muted">Currently on the test network. Test USDT only, no real money.</p>
            </div>
          </div>
        </section>
        <div className="cloud-band" aria-hidden="true"><div className="record-strip"><span>Invoice issued</span><span>Investor funds</span><span>Buyer pays</span><span>Record settles</span></div></div>
        <section className="marketing-container editorial">
          <p className="eyebrow">Work delivered. Capital still waiting.</p>
          <h2>Your invoice is a record.<br />Make it work for you.</h2>
          <div className="editorial-foot"><BrandScene scene="records" /><p>A payment link handles the last step. Your business needs the whole record: who owes what, where the money goes, and what happened next.</p></div>
          <p className="scene-caption">Concept illustrations — not product screenshots.</p>
        </section>
        <section id="how-it-works" className="marketing-container journey">
          <div className="section-head"><p className="eyebrow">One invoice. A clear path.</p><h2>From work done<br />to money received.</h2></div>
          <ol className="steps">
            <li><span className="step-number">01</span><h3>Send your invoice</h3><p>Create an invoice and share its payment link. Your customer sees the amount and the business they are paying.</p></li>
            <li><span className="step-number">02</span><h3>Explore financing</h3><p>Eligible businesses can list an invoice for verified investors. Review the quote and terms before you approve.</p></li>
            <li><span className="step-number">03</span><h3>Keep the record</h3><p>Payments, refunds and renewals stay connected. A confirmed receipt links back to the transaction.</p></li>
          </ol>
        </section>
        <section className="kit-section">
          <div className="marketing-container kit-grid">
            <div><p className="eyebrow">For the people building it</p><h2>Your business.<br />Your site.<br />Your agent.</h2><p className="mt-6 max-w-md">Connect using a prompt, an API or an SDK. Let an agent read and draft; keep consequential approvals with a person.</p><Link href="/docs" className="action paper mt-8">Open the developer docs <span aria-hidden="true">↗</span></Link></div>
            <div className="kit-links">{[
              ["API + webhooks", "Create invoices. Receive signed events.", "/docs/api"],
              ["MCP + OAuth", "Connect an agent with explicit permissions.", "/docs/mcp"],
              ["SDK + React", "Build checkout into your existing site.", "/docs/sdk"],
              ["Agent reference", "The full reference, in plain text.", "/llms-full.txt"],
            ].map(([title, description, href]) => <Link href={href!} key={title}><span>{title}<span aria-hidden="true">↗</span></span><p>{description}</p></Link>)}</div>
          </div>
        </section>
        <section className="marketing-container closing"><p className="eyebrow">Start with one invoice.</p><h2>Less waiting.<br />A better record.</h2><Link href="/signup" className="action accent">Try the test network <span aria-hidden="true">↗</span></Link><p className="text-muted mt-4">No payment guarantee. No custody. Payers bring their own USDT.</p></section>
      </main>
      <footer className="marketing-container marketing-footer"><Link href="/" className="text-3xl"><Logo /></Link><p>Stenmont · Business payments, settled in seconds onchain after confirmation.</p><nav aria-label="Footer"><Link href="/docs">Documentation</Link><Link href="/login">Sign in</Link><a href="/llms.txt">llms.txt</a></nav><p className="text-muted">Whitechain test network. Public transactions. Financing is a testnet demonstration.</p></footer>
    </div>
  );
}
