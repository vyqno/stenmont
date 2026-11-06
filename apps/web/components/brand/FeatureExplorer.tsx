"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AgentPreview, BooksPreview, FinancingPreview, InvoicePreview, StorePreview } from "./ProductCards";
import { GreyPanel } from "./Surface";

const FEATURES = [
  { title: "Sell", body: "Publish products and variants in a hosted storefront, or connect the shop you already run. Prices are checked on the server before checkout.", Component: StorePreview },
  { title: "Get paid", body: "Accept USDT at checkout or send a payment link. Customers bring their own funds; signed events connect each payment to its order.", Component: InvoicePreview },
  { title: "Books", body: "Reconcile sales receipts, refunds and financing in one period. Export a service-signed snapshot and verify its line proofs. Onchain anchoring is not enabled.", Component: BooksPreview },
  { title: "Capital", body: "Explore invoice funding for eligible businesses. Review the terms and claim timeline in this testnet demonstration; the live dashboard financing journey is still being verified.", Component: FinancingPreview },
  { title: "Agents", body: "A coding agent can install checkout; scoped tools can read records and prepare the next step. People retain consequential approvals. Live finance chat verification is pending.", Component: AgentPreview },
];
export function FeatureExplorer() {
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % FEATURES.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index + FEATURES.length - 1) % FEATURES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = FEATURES.length - 1;
    else return;
    event.preventDefault(); setSelected(next); buttons.current[next]?.focus();
  }

  return <div className="feature-explorer"><div role="tablist" aria-label="Explore the business kit" aria-orientation="vertical" className="feature-tabs">{FEATURES.map((feature, index) => <div className={`feature-option ${index === selected ? "selected" : ""}`} key={feature.title}><button ref={node => { buttons.current[index] = node; }} role="tab" id={`feature-tab-${index}`} aria-controls={`feature-panel-${index}`} aria-selected={index === selected} tabIndex={index === selected ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => navigate(event, index)}>{feature.title}<span aria-hidden="true">{index === selected ? "−" : "+"}</span></button>{index === selected && <p>{feature.body}</p>}</div>)}</div><GreyPanel className="feature-stage">{FEATURES.map(({ Component }, index) => <div key={index} id={`feature-panel-${index}`} role="tabpanel" aria-labelledby={`feature-tab-${index}`} tabIndex={0} hidden={index !== selected}><Component /></div>)}</GreyPanel></div>;
}
