"use client";

import type { Site } from "../../../lib/sites";
import { useApi } from "../../../lib/useApi";
import { PromptBox } from "./PromptBox";
import { SitePanel } from "./SitePanel";
import { SwitchCard } from "./SwitchCard";

export default function Connect() {
  const sites = useApi<{ data: Site[] }>("/v1/sites");
  const list = sites.data?.data ?? null;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Connect your site</h1>
        <p className="mt-1 text-muted">Paste one prompt into your AI coding agent and it installs checkout for you. Then come back here to see that it works.</p>
      </div>
      <SitePanel sites={list} reload={sites.reload} loadError={sites.error} />
      <PromptBox site={list?.[0] ?? null} />
      <SwitchCard />
    </div>
  );
}
