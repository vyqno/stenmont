"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, PageNotice } from "../../../components/ui";
import { AuthError, api } from "../../../lib/auth";
import {
  formFrom, formProblems, hasUnsavedEdits, keeper, pendingChanges, publishBody, publishErrorText, recordRows,
  type DirectoryView, type FormValues, type PublishAnswer,
} from "../../../lib/publicProfile";
import { NoNameState, ProfileView, type ElsewhereRow } from "./ProfileView";

type Name = { name: string; payoutLocked: boolean };
type A2a = { enabled: boolean; cardUrl: string; ens: { status: string; txHash: string | null } };
type Verification = { badge: { name: string; publishedTier: number | null } | null };

/** A 404 means "none yet"; any other failure is a real error. */
const orNull = <T,>(p: Promise<T>) => p.catch((e: unknown) => { if (e instanceof AuthError && e.code === "not_found") return null; throw e; });

export default function PublicProfile() {
  const [name, setName] = useState<Name | null | undefined>(undefined);
  const [view, setView] = useState<DirectoryView | null>(null);
  const [form, setForm] = useState<FormValues>({ payUrl: "", x402Url: "", refund: "" });
  const [a2a, setA2a] = useState<A2a | null>(null);
  const [trust, setTrust] = useState<Verification | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ txHash?: string; unchanged: boolean } | null>(null);
  const keys = useRef(keeper());

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const own = await orNull(api.get<Name>("/v1/ens/name"));
      setName(own);
      if (!own) return;
      const dir = await orNull(api.get<DirectoryView>("/v1/ens/directory"));
      setView(dir);
      setForm(formFrom(dir));
      // Both are shown for completeness; if either cannot be read the page still works.
      setA2a(await api.get<A2a>("/v1/agent-access").catch(() => null));
      setTrust(await api.get<Verification>("/v1/verification").catch(() => null));
    } catch (e) {
      setLoadError(e instanceof AuthError ? e.message : "Your profile could not be loaded. Refresh to try again.");
    }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const rows = useMemo(() => recordRows(view), [view]);
  const problems = useMemo(() => formProblems(form), [form]);

  const elsewhere: ElsewhereRow[] = [
    {
      label: "Agent card",
      value: a2a?.enabled ? a2a.cardUrl : null,
      status: !a2a ? "Unknown" : a2a.ens.status === "published" ? "Published" : a2a.enabled ? "Not published" : "Off",
      href: "/dashboard/agent-access",
      linkText: "Manage on Agent access",
    },
    {
      label: "Trust level",
      value: null,
      status: !trust ? "Unknown" : trust.badge?.publishedTier != null ? `Level ${trust.badge.publishedTier} published` : "Not published",
      href: "/dashboard/verification",
      linkText: "Manage on Verification",
    },
  ];

  async function submit() {
    if (busy || !name) return;
    setBusy(true);
    setError("");
    setSuccess(null);
    const body = publishBody(form);
    try {
      const r = await api.post<PublishAnswer>("/v1/ens/directory/publish", body, keys.current.keyFor(body));
      setSuccess({ ...(r.txHash ? { txHash: r.txHash } : {}), unchanged: r.status === "unchanged" });
      await load();
    } catch (e) {
      setError(e instanceof AuthError ? publishErrorText(e.code, name.payoutLocked) : "It could not be published. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Public profile" description="Publish how customers and AI agents can find and pay your business. Anyone can read it from your business name." />
      {loadError && <PageNotice kind="error">{loadError}</PageNotice>}
      {name === undefined && !loadError && <PageNotice kind="loading">Loading your profile…</PageNotice>}
      {name === null && <NoNameState />}
      {name && (
        <ProfileView
          name={name.name}
          payoutLocked={name.payoutLocked}
          rows={rows}
          elsewhere={elsewhere}
          form={form}
          problems={problems}
          unsaved={hasUnsavedEdits(form, view)}
          everPublished={!!view}
          publishedAt={view?.publishedAt ?? null}
          changes={pendingChanges(rows)}
          busy={busy}
          error={error}
          success={success}
          onChange={(k, v) => { setForm((f) => ({ ...f, [k]: v })); setSuccess(null); }}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
