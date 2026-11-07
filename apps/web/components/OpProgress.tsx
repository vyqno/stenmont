"use client";

import { useEffect, useState } from "react";

/** A real progress bar for the slow steps (a name or an agent is written to Ethereum Sepolia). We cannot see the block
 *  inside the request, so the bar is honest about what it knows: it moves through three named stages from the moment the
 *  request goes out, slows down as it nears the end, and only reaches 100% when the server has actually answered. */
const STAGES = ["Sending your request", "Writing it to Ethereum Sepolia", "Reading it back to confirm"];

export function OpProgress({ label }: { label: string }) {
  const [t, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT((x) => x + 1), 500); return () => clearInterval(id); }, []);
  const secs = t / 2;
  const pct = Math.min(94, 94 * (1 - Math.exp(-secs / 38)));
  const stage = secs < 4 ? 0 : pct < 70 ? 1 : 2;
  return (
    <div className="op" role="status" aria-live="polite" aria-label={`${label}: ${STAGES[stage]}`}>
      <div className="op-top"><span>{label}</span><span>{Math.round(pct)}%</span></div>
      <div className="op-bar"><i style={{ width: `${pct}%` }} /></div>
      <ol className="op-steps">{STAGES.map((s, i) => <li key={s} className={i < stage ? "done" : i === stage ? "now" : ""}>{s}</li>)}</ol>
      <p>Keep this page open. If the connection drops, refresh to see the confirmed state.</p>
    </div>
  );
}
