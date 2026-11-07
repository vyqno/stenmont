"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/** Real calls from the SDK, the webhook verifier and the agent client. The tokenization tab shows the events a server
 *  receives as a sold invoice moves through its claim. */
const TABS = [
  {
    id: "pay", label: "Take a payment",
    gain: ["One server call creates the checkout. The price never comes from the browser.", "A retry key makes the call safe to repeat.", "The customer pays with a passkey and you never see a key."],
    code: `import { Stenmont } from "@vyqno/sdk";

const stenmont = new Stenmont({ apiKey: process.env.STENMONT_API_KEY! });

// Create the checkout on your server, then send the customer to session.url.
const session = await stenmont.checkout.sessions.create({
  amount: order.total,
  successUrl: \`https://shop.example/orders/\${order.id}\`,
  cancelUrl: "https://shop.example/cart",
  metadata: { order: order.id },
}, { idempotencyKey: order.checkoutKey });`,
  },
  {
    id: "confirm", label: "Confirm it",
    gain: ["Every event is signed. A forged payment cannot mark an order paid.", "Fulfil once, even if the event arrives twice.", "The same check works in Node and Python."],
    code: `import { verifyWebhook } from "@vyqno/sdk";

// The raw body and the signature header prove the payment happened.
const event = await verifyWebhook(\n  rawBody, signatureHeader, process.env.STENMONT_WEBHOOK_SECRET!,\n);

if (event.type === "invoice.paid") {
  // Match the invoice id and amount to your stored order, then fulfil once.
}`,
  },
  {
    id: "sell", label: "Sell an invoice",
    gain: ["A sold invoice is a claim token that only allowlisted investors can hold.", "The customer's payment repays the holder inside the contract, not in our API.", "Your server hears every step and can show the timeline."],
    code: `// A business sells an unpaid invoice as a claim token. Your server hears each step.
const event = await verifyWebhook(rawBody, signatureHeader, secret);

switch (event.type) {
  case "claim.funded":    // an allowlisted investor bought it
  case "claim.settled":   // the customer paid and the investor was repaid
  case "claim.defaulted": // grace period over; the investor takes the hold-back
}`,
  },
  {
    id: "agent", label: "Limit an agent",
    gain: ["The agent pays 402 answers by itself, inside limits.", "Limits are checked before anything is signed, so an over-limit request never leaves.", "A large limit needs a person to approve it with World ID."],
    code: `import { createAgentFetch } from "@vyqno/agent";
import { privateKeyToAccount } from "viem/accounts";

const payingFetch = createAgentFetch({
  account: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`),
  maxPerRequest: "0.05",   // refuse any single price above this
  dailyLimit: "1.00",      // refuse once a day's spend would pass this
  allowedHosts: ["shop-staging.stenmont.com"],
});

const res = await payingFetch("https://shop-staging.stenmont.com/api/premium/quote");`,
  },
] as const;

const LINKS: readonly (readonly [string, string, string])[] = [
  ["API", "/docs/api", "Catalogue, checkout and signed events."],
  ["SDK and React", "/docs/sdk", "A checkout button and a typed client."],
  ["MCP and OAuth", "/docs/mcp", "Scoped access for agents."],
  ["Agent reference", "/llms-full.txt", "Everything, in plain text."],
];

const FILES: Record<string, string> = { pay: "checkout.ts", confirm: "webhook.ts", sell: "claims.ts", agent: "agent.ts" };
const KEYWORDS = /\b(import|from|const|await|new|if|switch|case|return|async|function|as|typeof)\b/g;

/** A small, dependency-free highlighter: comments, strings, keywords and numbers. */
function highlight(line: string) {
  const cut = (/(^|\s)\/\/\s/.exec(line));
  const code = cut ? line.slice(0, cut.index + cut[1]!.length) : line;
  const comment = cut ? line.slice(cut.index + cut[1]!.length) : "";
  const out: React.ReactNode[] = [];
  const re = /("[^"\n]*"|'[^'\n]*'|`[^`\n]*`)|\b(\d+(?:\.\d+)?)\b/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  const words = (t: string) => t.split(KEYWORDS).map((part, i) => (i % 2 ? <span key={`${k++}`} className="tk-k">{part}</span> : part));
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(...words(code.slice(last, m.index)));
    out.push(<span key={`${k++}`} className={m[1] ? "tk-s" : "tk-n"}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  out.push(...words(code.slice(last)));
  if (comment) out.push(<span key={`${k++}`} className="tk-c">{comment}</span>);
  return out;
}

function CodeBlock({ file, text }: { file: string; text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1600); } catch { setDone(false); }
  }
  const lines = text.split("\n");
  return (
    <figure className="cb">
      <figcaption className="cb-head"><span>{file}</span><button type="button" onClick={copy}>{done ? "Copied" : "Copy"}</button></figcaption>
      <pre><code>{lines.map((line, i) => <span key={i} className="cb-ln"><i aria-hidden="true">{i + 1}</i>{highlight(line)}{"\n"}</span>)}</code></pre>
    </figure>
  );
}

export function DevShowcase() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [auto, setAuto] = useState(true);
  // The tabs play themselves until someone takes over, so every example gets seen.
  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % TABS.length), 6500);
    return () => clearInterval(id);
  }, [auto]);
  function key(e: KeyboardEvent<HTMLButtonElement>) {
    const n = TABS.length;
    const next = e.key === "ArrowRight" ? (active + 1) % n : e.key === "ArrowLeft" ? (active + n - 1) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault(); setAuto(false); setActive(next); tabs.current[next]?.focus();
  }
  const t = TABS[active]!;
  return (
    <section id="developers" className="v2-dev">
      <div className="v2-wrap">
        <div className="v2-dev-head">
          <div>
            <p className="v2-eyebrow v2-eyebrow-light">For developers</p>
            <h2 className="v2-h v2-title v2-title-light">A few calls, <span className="v2-blue-soft">the whole loop.</span></h2>
          </div>
        </div>
        <div className="dev-show" onMouseEnter={() => setAuto(false)}>
          <div role="tablist" aria-label="What you can build" className="dev-tabs">
            {TABS.map((tab, i) => <button key={tab.id} ref={(n) => { tabs.current[i] = n; }} id={`dev-t-${tab.id}`} role="tab" type="button" aria-selected={i === active} aria-controls="dev-panel" tabIndex={i === active ? 0 : -1} onClick={() => { setAuto(false); setActive(i); }} onKeyDown={key}>{tab.label}</button>)}
          </div>
          <div id="dev-panel" role="tabpanel" aria-labelledby={`dev-t-${t.id}`} className="dev-panel">
            <div className="dev-left"><ul className="dev-gain">{t.gain.map((g) => <li key={g}>{g}</li>)}</ul><Link href="/docs" className="v3-btn dev-docs-btn">Read the documentation</Link></div>
            <div className="dev-code"><CodeBlock key={t.id} file={FILES[t.id] ?? "example.ts"} text={t.code} /></div>
          </div>
        </div>
        <div className="dev-marquee" aria-label="Documentation"><div className="dev-marquee-track">{[0, 1].map((k) => <div className="dev-marquee-row" key={k} aria-hidden={k === 1 ? true : undefined}>{LINKS.map(([title, href, body]) => <Link key={`${k}-${title}`} href={href} tabIndex={k === 1 ? -1 : undefined}><span>{title}</span><p>{body}</p></Link>)}</div>)}</div></div>
      </div>
    </section>
  );
}
