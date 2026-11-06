"use client";
import { useState } from "react";
import { ConnectedApps } from "../../../components/ConnectedApps";
import { AuthError, api } from "../../../lib/auth";
import { useApi } from "../../../lib/useApi";
import { Card, primaryButton } from "../../../components/ui";
export type AgentAccess = { enabled: boolean; skills: string[]; availableSkills: { id: string; scope: string }[]; cardUrl: string; ens: { name: string | null; record: string; status: string; txHash: string | null } };
export function AgentAccessControls({ data, reload }: { data: AgentAccess; reload: () => void }) {
  const [enabled, setEnabled] = useState(data.enabled);
  const [skills, setSkills] = useState(data.skills);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function update(revoke = false) {
    setBusy(true); setMessage("");
    try {
      await api.post("/v1/agent-access", { enabled: revoke ? false : enabled, skills: revoke ? [] : skills });
      if (revoke) { setEnabled(false); setSkills([]); }
      setMessage(revoke ? "Agent access revoked. New calls are blocked." : "Agent access saved."); reload();
    } catch (e) { setMessage(e instanceof AuthError ? e.message : "The change could not be saved. Try again."); }
    finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); setMessage("");
    try { await api.post("/v1/agent-access/publish-ens"); setMessage("Discovery record published. Refresh ENS status to see the transaction."); reload(); }
    catch (e) { setMessage(e instanceof AuthError ? e.message : "Discovery could not be published. Try again."); }
    finally { setBusy(false); }
  }
  return <>
    <Card title="Skills and permissions">
      <p className="mb-4 text-sm text-muted">Connected agents can read the skills you choose and prepare invoice drafts. You review a draft before creating its payable invoice.</p>
      <label className="flex items-center gap-3 font-medium"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={busy} />Allow agent access</label>
      <fieldset disabled={busy} className="mt-4 space-y-3">
        <legend className="mb-2 font-medium">Allowed skills</legend>
        {data.availableSkills.map(s => <label key={s.id} className="flex items-center gap-3"><input type="checkbox" checked={skills.includes(s.id)} onChange={e => setSkills(e.target.checked ? [...skills, s.id] : skills.filter(v => v !== s.id))} /><span>{s.id.replaceAll("_", " ")} <span className="text-sm text-muted">({s.scope} permission)</span></span></label>)}
      </fieldset>
      <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} onClick={() => update()} className={`rounded px-4 py-2 font-medium ${primaryButton}`}>{busy ? "Saving…" : "Save access"}</button><button disabled={busy || !data.enabled} onClick={() => update(true)} className="rounded border border-line px-4 py-2 disabled:opacity-50">Revoke all agent access</button></div>
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    </Card>
    <Card title="ENS discovery">
      <p>{data.ens.name ?? "Claim a business name in Identity to enable ENS discovery."}</p>
      <p className="mt-2 text-sm text-muted">{data.ens.record}: {data.ens.status === "published" ? "Published by the registrar" : "Publication pending"}</p>
      <p className="mt-2 break-all font-mono text-xs">{data.cardUrl}</p>
      {data.ens.txHash && <p className="mt-2 break-all font-mono text-xs">Transaction: {data.ens.txHash}</p>}
      <button disabled={busy || !data.enabled || !data.ens.name} onClick={publish} className="mt-4 rounded border border-line px-4 py-2 disabled:opacity-50">Publish discovery record</button>
      <p className="mt-3 text-sm text-muted">Revoking access immediately blocks calls, including calls from cached cards. Disconnect individual apps below to revoke their OAuth tokens.</p>
    </Card>
  </>;
}
export default function AgentAccessPage() {
  const state = useApi<AgentAccess>("/v1/agent-access");
  return <div className="flex flex-col gap-6"><h1 className="text-3xl font-bold">Agent access</h1>
    {state.error ? <Card title="Access could not load"><p role="alert">{state.error}</p><button onClick={state.reload} className="mt-3 rounded border border-line px-3 py-2">Try again</button></Card> : !state.data ? <p role="status">Loading agent access…</p> : <AgentAccessControls key={JSON.stringify(state.data)} data={state.data} reload={state.reload} />}
    <ConnectedApps />
  </div>;
}
