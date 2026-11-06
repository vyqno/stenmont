"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { SAMPLES } from "../../lib/docSamples";

const OPTIONS = ["Prompt", "cURL"];
export function DeveloperConsole() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  function key(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : ["ArrowLeft", "ArrowRight"].includes(event.key) ? 1 - active : null;
    if (next === null) return;
    event.preventDefault(); setActive(next); tabs.current[next]?.focus();
  }
  return <div className="developer-console"><div role="tablist" aria-label="Integration example">{OPTIONS.map((label,i) => <button type="button" key={label} ref={node=>{tabs.current[i]=node;}} id={`dev-tab-${i}`} role="tab" aria-selected={i===active} aria-controls={`dev-panel-${i}`} tabIndex={i===active?0:-1} onClick={()=>setActive(i)} onKeyDown={key}>{label}</button>)}</div><div role="tabpanel" id={`dev-panel-${active}`} aria-labelledby={`dev-tab-${active}`} tabIndex={0}><pre><code>{active === 0 ? "Read https://app-staging.stenmont.com/llms-full.txt.\n\nHelp me add Stenmont checkout to my business site.\nKeep keys on the server. Save a retry key with each order.\nBind signed payment events to the stored invoice and amount.\nUse an already-funded payer on the test network.\nShow me the changes before I approve them." : SAMPLES.createInvoiceCurl.code}</code></pre></div><p>Test network · keep credentials on your server</p></div>;
}
