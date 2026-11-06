"use client";

import { useSyncExternalStore } from "react";
import { fundingFor } from "../lib/funding";

const subscribe = () => () => {};

/** Where USDT on Whitechain comes from. Collapsed by default: most customers never need it. Facts only; we run no on-ramp. */
export default function FundingHelp() {
  const hostname = useSyncExternalStore<string | null>(subscribe, () => location.hostname, () => null);
  if (hostname === null) return null;
  const f = fundingFor(hostname);
  return (
    <details className="text-sm" data-testid="funding-help">
      <summary className="cursor-pointer text-muted underline">{f.title}</summary>
      <div className="mt-2 space-y-2 text-muted">
        <ul className="list-disc space-y-1 pl-5">
          {f.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p>
          Whitechain&apos;s bridge:{" "}
          <a className="underline" href={f.bridgeUrl} target="_blank" rel="noreferrer">
            {f.bridgeUrl.replace("https://", "")}
          </a>
        </p>
        <p>{f.disclaimer}</p>
        {f.testNote && <p data-testid="funding-test-note">{f.testNote}</p>}
      </div>
    </details>
  );
}
