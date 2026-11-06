"use client";

import { useEffect, useState } from "react";
import { AuthError, api } from "../../../lib/auth";
import { parseAuthorizeQuery, safeReturn, signInHref } from "../../../lib/oauth";
import { ConsentView } from "./ConsentView";

type Request = { client: { id: string; name: string }; redirectHost: string; scopes: string[]; business: string };

export default function Consent() {
  const [req, setReq] = useState<Request | null>(null);
  const [signIn, setSignIn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(parseAuthorizeQuery(location.search)).toString();
    api.get<Request>(`/oauth/authorize?${query}`).then(setReq, (e: unknown) => {
      if (e instanceof AuthError && e.code === "unauthorized") setSignIn(signInHref(location.pathname + location.search));
      else setError(e instanceof AuthError ? e.message : "This request could not be checked. Try connecting again from the app.");
    });
  }, []);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    try {
      const { redirectTo } = await api.post<{ redirectTo: string }>("/oauth/authorize", { ...parseAuthorizeQuery(location.search), decision });
      const to = safeReturn(redirectTo);
      if (!to) throw new Error("bad return address");
      location.assign(to);
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "That did not work. Try connecting again from the app.");
      setBusy(false);
    }
  }

  if (signIn) {
    return (
      <p>
        Sign in to Stenmont to continue. <a href={signIn} className="underline">Sign in</a>
      </p>
    );
  }
  if (error) return <p role="status" className="text-danger">{error}</p>;
  if (!req) return <p className="text-muted">Checking the request…</p>;
  return <ConsentView client={req.client} redirectHost={req.redirectHost} scopes={req.scopes} business={req.business} busy={busy} onDecide={decide} />;
}
