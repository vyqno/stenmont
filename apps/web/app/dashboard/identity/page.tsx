"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, Card } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import { AGENT_SCOPES, agentApprovalParams, canClaimLabel, parseAgentInput, type Agent, type AgentForm, type Availability, type BusinessName } from "../../../lib/identity";
import { useMerchant } from "../DashboardShell";

const field = "mt-1 block w-full rounded border border-line bg-surface px-3 py-2 text-sm";
const button = "rounded border border-line px-4 py-2 text-sm font-medium hover:border-brand disabled:cursor-not-allowed disabled:opacity-50";
const initial: AgentForm = { label: "", agentAddress: "", dailyLimit: "50", perTxLimit: "10", expiresInDays: "30", scopes: ["invoice.read", "refund.draft"], context: "", endpoint: "" };
const message = (e: unknown) => e instanceof AuthError ? e.message : "The request could not be completed. Refresh and try again.";

export default function Identity() {
  const merchant = useMerchant();
  const [name, setName] = useState<BusinessName | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [resolved, setResolved] = useState<string | null>(null);
  const [resolutionError, setResolutionError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [label, setLabel] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [member, setMember] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [form, setForm] = useState<AgentForm>(initial);
  const [approvalNeeded, setApprovalNeeded] = useState(false);
  const [approvalUrl, setApprovalUrl] = useState("");
  const restored = useRef(false);
  const draftKey = `stenmont:agent-draft:${merchant.id}`;

  const reload = useCallback(async () => {
    let own: BusinessName | null;
    try { own = await api.get<BusinessName>("/v1/ens/name"); }
    catch (e) {
      if (e instanceof AuthError && e.code === "not_found") own = null;
      else throw e;
    }
    setName(own);
    if (own) {
      const listed = await api.get<{ data: Agent[] }>("/v1/ens/agents");
      setAgents(listed.data);
      setResolved(null);
      try {
        const r = await api.get<{ name: string; address: string | null }>("/v1/ens/resolution");
        setResolved(r.address);
        setResolutionError("");
      } catch (e) { setResolutionError(message(e)); }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Schedule loading after effect setup; all state updates happen in async callbacks.
    void Promise.resolve().then(reload).then(() => {
      if (restored.current) return;
      restored.current = true;
      try {
        const saved = sessionStorage.getItem(draftKey);
        if (saved) {
          const draft = JSON.parse(saved) as AgentForm;
          if (parseAgentInput(draft)) setForm(draft);
        }
      } catch { /* An unavailable or invalid draft must not prevent loading identity. */ }
      const params = new URLSearchParams(window.location.search);
      const approval = params.get("approval");
      if (approval && /^[a-f0-9]{32}$/.test(approval)) {
        void api.get<{ status: string }>(`/v1/approvals/${approval}`).then((r) => {
          setStatus(r.status === "approved" ? "World approved these terms. Review the agent details and press Create agent name to finish." : "World approval was not completed or has expired. No agent was created.");
        }).catch((e) => setError(message(e)));
      }
    }).catch((e) => setError(message(e)));
  }, [reload, draftKey]);

  async function run(action: string, work: () => Promise<void>) {
    if (pending) return;
    setPending(action); setError(""); setStatus("");
    try { await work(); } catch (e) { setError(message(e)); }
    finally { setPending(""); }
  }
  function update<K extends keyof AgentForm>(key: K, value: AgentForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setApprovalNeeded(false); setApprovalUrl("");
  }
  function submit(e: FormEvent, action: string, work: () => Promise<void>) {
    e.preventDefault(); void run(action, work);
  }
  async function createAgent() {
    const input = parseAgentInput(form);
    if (!input) { setError("Check the agent label, address, limits, expiry, scopes and HTTPS endpoint. The per-payment limit must not exceed the daily limit."); return; }
    setApprovalNeeded(false);
    try {
      await api.post("/v1/ens/agents", input);
      try { sessionStorage.removeItem(draftKey); } catch { /* Optional draft storage. */ }
      setApprovalUrl("");
      await reload(); setStatus("Agent name created. Its policy is published with its identity.");
    } catch (e) {
      if (e instanceof AuthError && ["approval_required", "approval_expired", "approval_denied"].includes(e.code)) setApprovalNeeded(true);
      throw e;
    }
  }
  async function requestApproval() {
    const input = parseAgentInput(form);
    if (!input) return;
    // Store public policy details only; the approval remains on the server and is bound to these exact terms.
    try { sessionStorage.setItem(draftKey, JSON.stringify(form)); }
    catch { setError("This browser cannot save the draft. Keep a copy of the agent details before opening World."); return; }
    const result = await api.post<{ authorizeUrl: string }>("/v1/approvals", { operation: "agent_limit", params: agentApprovalParams(input) });
    const url = new URL(result.authorizeUrl);
    if (url.origin !== "https://auth.world.org") throw new Error("Unexpected approval service");
    setApprovalUrl(result.authorizeUrl);
    setStatus("Your approval request is ready. Open World to complete it, then return here. No agent has been created.");
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-bold">Identity</h1><p className="mt-2 text-sm text-muted">A name for your business, limited access for your team, and identities for your agents.</p></div>
        <button className={button} disabled={!!pending} onClick={() => run("refresh", reload)}>Refresh identity</button>
      </div>
      {error && <p role="alert" className="rounded border border-danger p-3 text-sm text-danger">{error}</p>}
      {status && <p role="status" className="rounded border border-mint p-3 text-sm">{status}</p>}
      {pending && <p aria-live="polite" className="text-sm text-muted">{pending === "check" ? "Checking availability…" : "Working… This may take a few minutes. Keep this page open; refresh to check confirmed state if the connection is interrupted."}</p>}
      {!loaded ? <p className="text-muted">{error ? "Identity could not be loaded. Use Refresh identity to retry." : "Loading identity…"}</p> : !name ? (
        <Card title="Give your business a name">
          <p className="mb-4 text-sm text-muted">Choose a unique name for payment links and your agents. Names are registered on ENS Sepolia for this test environment.</p>
          <form onSubmit={(e) => submit(e, "check", async () => {
            setAvailability(null);
            setAvailability(await api.get<Availability>(`/v1/ens/availability?label=${encodeURIComponent(label)}`));
          })} className="flex flex-col gap-3">
            <label className="text-sm">Business label<input className={field} value={label} onChange={(e) => { setLabel(e.target.value); setAvailability(null); }} required maxLength={32} autoComplete="off" /></label>
            <p className="text-xs text-muted">3–32 lowercase letters, numbers or hyphens. Your name will end in .stenmont.eth.</p>
            <div className="flex flex-wrap gap-3">
              <button className={button} disabled={!!pending}>Check availability</button>
              <button type="button" className={button} disabled={!!pending || !canClaimLabel(label, availability)} onClick={() => run("claim", async () => {
                await api.post("/v1/ens/claim-name", { label });
                setAvailability(null); await reload(); setStatus("Your business name is ready.");
              })}>Claim business name</button>
            </div>
            {availability?.label === label && <p className="text-sm">{availability.available ? `${label} is available. Availability is checked again when you claim.` : "That name is taken. Try another label."}</p>}
          </form>
        </Card>
      ) : (
        <>
          <Card title="Your business name">
            <p className="break-all text-xl font-bold" data-testid="business-ens-name">{name.name}</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div><dt className="text-muted">Currently resolves to</dt><dd className="break-all font-mono" data-testid="resolved-address">{resolved ?? (resolutionError ? "Unavailable" : "No address record")}</dd></div>
              <div><dt className="text-muted">Permissioned resolver</dt><dd className="break-all font-mono"><a className="underline" href={`https://sepolia.etherscan.io/address/${name.resolver}`} target="_blank" rel="noreferrer">{name.resolver}</a></dd></div>
            </dl>
            {resolutionError && <p className="mt-3 text-sm text-danger">{resolutionError}</p>}
          </Card>
          <Card title="Finance team access">
            <p className="mb-3 text-sm text-muted">A finance member can edit only the business profile record (stenmont.profile). This role cannot change the payout, sign in to this dashboard or move money. Add members before locking the payout.</p>
            <form onSubmit={(e) => submit(e, "finance", async () => {
              await api.post("/v1/ens/finance", { member });
              setStatus("Finance member can now edit only the profile record."); setMember("");
            })} className="flex flex-col gap-3">
              <label className="text-sm">Finance member address<input className={field} value={member} onChange={(e) => setMember(e.target.value)} required pattern="0x[0-9a-fA-F]{40}" disabled={name.payoutLocked || !!pending} /></label>
              <button className={`${button} self-start`} disabled={name.payoutLocked || !!pending}>Add finance member</button>
            </form>
          </Card>
          <Card title="Permanent payout lock">
            <p className="font-medium" data-testid="payout-state">{name.payoutLocked ? "Payout permanently locked" : "Payout not locked"}</p>
            {!name.payoutLocked && <>
              <p className="mt-2 text-sm text-muted">This permanently removes the platform’s right to change this name’s payout. It cannot be undone, and you cannot add more finance members afterward. Check the resolved address above and add your team first.</p>
              <label className="my-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I understand this permanently locks the payout and prevents adding more finance members.</label>
              <button className={button} disabled={!confirmed || !resolved || !!resolutionError || !!pending} onClick={() => run("lock", async () => {
                await api.post("/v1/ens/lock-payout"); await reload(); setConfirmed(false); setStatus("The payout is permanently locked.");
              })}>Lock payout permanently</button>
            </>}
          </Card>
          <Card title="Agent names">
            <p className="text-sm text-muted">Each agent gets its own identity, policy and expiry. These ENS records describe its permissions; payment integrations must enforce the spending policy. A daily grant above 100 USDT requires fresh World approval.</p>
            {agents.length === 0 ? <p className="mt-4 text-sm">No agents yet. Create a name below to connect your first agent.</p> : <ul className="mt-4 divide-y divide-line">
              {agents.map((agent) => <li data-testid="agent-row" key={agent.name} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1"><p className="break-all font-medium">{agent.name}</p><p className="mt-1 break-all font-mono text-xs text-muted">{agent.agentAddress}</p><p className="mt-2 text-sm">{agent.dailyLimit} USDT/day · {agent.perTxLimit} per payment</p><p className="text-xs text-muted">{agent.scopes.join(", ")} · Expires {new Date(agent.expiresAt).toLocaleDateString()}</p></div>
                <Badge tone={agent.status === "active" ? "ok" : "off"}>{agent.status}</Badge>
                {agent.status !== "revoked" && <button className={button} disabled={!!pending} onClick={() => run("revoke", async () => { await api.delete(`/v1/ens/agents/${encodeURIComponent(agent.label)}`); await reload(); setStatus("Agent revoked. Its name and profile-editing permission have been removed."); })}>Revoke</button>}
              </li>)}
            </ul>}
            <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(e) => submit(e, "agent", createAgent)}>
              <label className="text-sm">Agent label<input className={field} value={form.label} onChange={(e) => update("label", e.target.value)} required maxLength={32} /></label>
              <label className="text-sm">Agent address<input className={field} value={form.agentAddress} onChange={(e) => update("agentAddress", e.target.value)} required /></label>
              <label className="text-sm">Daily limit (USDT)<input className={field} inputMode="decimal" value={form.dailyLimit} onChange={(e) => update("dailyLimit", e.target.value)} required /></label>
              <label className="text-sm">Per-payment limit (USDT)<input className={field} inputMode="decimal" value={form.perTxLimit} onChange={(e) => update("perTxLimit", e.target.value)} required /></label>
              <label className="text-sm">Expires in days<input className={field} type="number" min="1" max="365" value={form.expiresInDays} onChange={(e) => update("expiresInDays", e.target.value)} required /></label>
              <label className="text-sm">Agent endpoint (optional)<input className={field} type="url" placeholder="https://" value={form.endpoint} onChange={(e) => update("endpoint", e.target.value)} /></label>
              <label className="text-sm sm:col-span-2">Agent context (optional)<textarea className={field} maxLength={500} value={form.context} onChange={(e) => update("context", e.target.value)} /></label>
              <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm">Allowed scopes</legend><div className="flex flex-wrap gap-4">{AGENT_SCOPES.map((scope) => <label key={scope} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.scopes.includes(scope)} onChange={(e) => update("scopes", e.target.checked ? [...form.scopes, scope] : form.scopes.filter((s) => s !== scope))} />{scope}</label>)}</div></fieldset>
              <div className="flex flex-wrap gap-3 sm:col-span-2">
                <button className={button} disabled={!!pending}>Create agent name</button>
                {approvalNeeded && <button type="button" className={button} disabled={!!pending} onClick={() => run("approval", requestApproval)}>Request World approval</button>}
                {approvalUrl && <a className={`${button} underline`} href={approvalUrl}>Open World to approve</a>}
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
