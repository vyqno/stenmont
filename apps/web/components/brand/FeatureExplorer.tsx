"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AgentPreview, BooksPreview, FinancingPreview, InvoicePreview } from "./ProductCards";
import { GreyPanel } from "./Surface";

const FEATURES = [
  { title: "Get paid", body: "An invoice, a payment link and a record of what happened. Give every business payment a clear path.", Component: InvoicePreview },
  { title: "Books", body: "Keep payments, refunds and financing in the same period. Export a record your accountant can work with.", Component: BooksPreview },
  { title: "Sell invoices", body: "Eligible businesses can offer receivables to verified investors. Review the quote, the terms and the claim timeline.", Component: FinancingPreview },
  { title: "Agents", body: "Let an agent read and prepare the next step. Keep consequential approvals with a person.", Component: AgentPreview },
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
  const Active = FEATURES[selected]!.Component;
  return <div className="feature-explorer"><div role="tablist" aria-label="Explore the business kit" aria-orientation="vertical" className="feature-tabs">{FEATURES.map((feature, index) => <div className={`feature-option ${index === selected ? "selected" : ""}`} key={feature.title}><button ref={node => { buttons.current[index] = node; }} role="tab" id={`feature-tab-${index}`} aria-controls={`feature-panel-${index}`} aria-selected={index === selected} tabIndex={index === selected ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => navigate(event, index)}>{feature.title}<span aria-hidden="true">{index === selected ? "−" : "+"}</span></button>{index === selected && <p>{feature.body}</p>}</div>)}</div><GreyPanel className="feature-stage"><div id={`feature-panel-${selected}`} role="tabpanel" aria-labelledby={`feature-tab-${selected}`} tabIndex={0}><Active /></div></GreyPanel></div>;
}
