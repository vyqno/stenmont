"use client";
import { useState } from "react";
import { Card, money } from "../../../components/ui";
import { api, AuthError } from "../../../lib/auth";
import { useApi } from "../../../lib/useApi";
type Action = { id: string; subject: string; message: string; status: string; kind: string; terms: string; exception: number; toEmail: string | null };
type Policy = { maxInstalments: number; maxExtensionDays: number; maxDiscountBps: number };
export default function Collections() {
  const actions = useApi<{ data: Action[] }>("/v1/collections/actions");
  const overdue = useApi<{ data: { id: string; outstanding: string; dueDate: string }[] }>("/v1/collections/overdue");
  const policy = useApi<Policy>("/v1/collections/policy");
  const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  async function post(path: string, body: unknown) {
    setBusy(path); setError(""); setNotice("");
    try { await api.post(`/v1/collections/${path}`, body); actions.reload(); policy.reload(); setNotice(path.includes("publish") ? "Policy published to ENS." : "Saved. Nothing has been sent."); }
    catch (e) { setError(e instanceof AuthError ? e.message : "Could not save. Try again."); }
    finally { setBusy(""); }
  }
  const button = "rounded border border-line px-3 py-2 disabled:opacity-50";
  return <div className="flex flex-col gap-6">
    <h1 className="text-3xl font-bold">Collections</h1>
    <p className="text-muted">Review reminders and B2B plan proposals. Approvals record your decision; email delivery and automatic plan execution are disabled.</p>
    {(error || actions.error || overdue.error || policy.error) && <p role="alert">{error || actions.error || overdue.error || policy.error}</p>}
    {notice && <p role="status">{notice}</p>}
    <Card title="Agent policy">
      {!policy.data && !policy.error && <p role="status">Loading policy…</p>}
      {policy.data && <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void post("policy", { maxInstalments: Number(f.get("parts")), maxExtensionDays: Number(f.get("days")), maxDiscountBps: 0 }); }} className="flex flex-wrap gap-4">
        <label>Maximum parts <input name="parts" type="number" min={0} max={3} defaultValue={policy.data.maxInstalments} className={button} /></label>
        <label>Maximum extension days <input name="days" type="number" min={0} max={366} defaultValue={policy.data.maxExtensionDays} className={button} /></label>
        <button disabled={!!busy} className={button}>Save policy</button>
        <button type="button" disabled={!!busy} onClick={() => post("policy/publish", {})} className={button}>Publish saved policy to ENS</button>
      </form>}
      <p className="mt-3 text-sm text-muted">Outside-policy proposals require World approval before a draft can enter this queue. Discounts are unavailable. The ENS record is stenmont.collections.</p>
    </Card>
    <Card title="Overdue invoices">
      {!overdue.data && !overdue.error && <p role="status">Loading invoices…</p>}
      {overdue.data?.data.length === 0 && <p>No overdue invoices.</p>}
      <ul>{overdue.data?.data.map(i => <li key={i.id} className="flex flex-wrap items-center gap-3 py-3"><a className="underline" href={`/pay/${i.id}`}>{i.id.slice(0, 12)}…</a><span>{money(i.outstanding)} · due {i.dueDate.slice(0, 10)}</span><button className={button} disabled={!!busy} onClick={() => post("reminders", { invoiceId: i.id })}>Draft reminder</button></li>)}</ul>
    </Card>
    <Card title="Merchant review queue">
      {!actions.data && !actions.error && <p role="status">Loading drafts…</p>}
      {actions.data?.data.length === 0 && <p>No collection drafts yet.</p>}
      <ul>{actions.data?.data.map(a => <li key={a.id} className="border-b border-line py-4">
        <p className="font-semibold">{a.subject} · {a.status}</p><p className="text-sm text-muted">{a.kind} · {a.toEmail ?? "No email recorded"}{a.exception ? " · World exception approved" : ""}</p>
        <p className="my-3 whitespace-pre-wrap">{a.message}</p>{a.kind === "instalments" && <pre className="overflow-auto text-sm">{a.terms}</pre>}
        {a.status === "pending" && <div className="flex gap-2"><button className={button} disabled={!!busy} onClick={() => post(`actions/${a.id}/decide`, { decision: "approve" })}>Approve draft</button><button className={button} disabled={!!busy} onClick={() => post(`actions/${a.id}/decide`, { decision: "deny" })}>Deny</button></div>}
      </li>)}</ul>
    </Card>
  </div>;
}
