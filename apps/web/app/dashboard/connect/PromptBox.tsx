"use client";

import { useMemo, useRef, useState } from "react";
import { Card } from "../../../components/ui";
import { apiBase } from "../../../lib/pay";
import { PLATFORMS, buildPrompt, type Platform } from "../../../lib/prompts";
import type { Site } from "../../../lib/sites";
import { useMerchant } from "../DashboardShell";

/** Pick a platform, copy the prompt, paste it into your AI coding agent. The prompt holds public ids only. */
export function PromptBox({ site }: { site: Site | null }) {
  const merchant = useMerchant();
  const [platform, setPlatform] = useState<Platform>("nextjs");
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const prompt = useMemo(
    () =>
      buildPrompt({
        platform,
        apiUrl: apiBase(location.hostname),
        appUrl: location.origin,
        businessName: merchant.name,
        merchantId: merchant.id,
        site: site ? { url: site.url, ...site.verification } : undefined,
      }),
    [platform, merchant.id, merchant.name, site],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("yes");
    } catch {
      area.current?.select(); // clipboard blocked: the text is selected so Ctrl/Cmd+C works
      setCopied("no");
    }
  }

  return (
    <Card title="2. Copy this into your AI coding agent">
      <p className="text-sm text-muted">Works with Claude Code, Cursor, Copilot, ChatGPT and similar tools. It tells the agent what to build, where your secrets go and when it is done. The prompt contains no secret.</p>
      <fieldset className="mt-3">
        <legend className="mb-2 text-sm font-medium">What is your site built with?</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Platform">
          {PLATFORMS.map((p) => (
            <label key={p.id} className={`cursor-pointer rounded border px-3 py-1.5 text-sm ${platform === p.id ? "border-brand bg-surface font-medium" : "border-line text-muted hover:text-foreground"}`}>
              <input type="radio" name="platform" value={p.id} checked={platform === p.id} onChange={() => { setPlatform(p.id); setCopied(null); }} className="sr-only" />
              {p.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">{PLATFORMS.find((p) => p.id === platform)!.blurb}</p>
      </fieldset>
      <label htmlFor="prompt" className="sr-only">Prompt for your AI agent</label>
      <textarea id="prompt" ref={area} readOnly value={prompt} rows={14} data-testid="prompt" className="mt-3 w-full rounded border border-line bg-background p-3 font-mono text-xs" />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={copy} className="rounded bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90">Copy prompt</button>
        <span role="status" className="text-sm text-muted">
          {copied === "yes" && "Copied. Paste it into your agent."}
          {copied === "no" && "Your browser blocked copying. The text is selected: press Ctrl or Cmd + C."}
        </span>
      </div>
      <p className="mt-3 text-sm text-muted">
        Prefer to do it yourself? Read the <a className="underline" href="/docs">docs</a>. Your agent can read <a className="underline" href="/llms.txt">/llms.txt</a>.
      </p>
    </Card>
  );
}
