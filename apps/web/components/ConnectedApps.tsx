"use client";

import { useState } from "react";
import { AuthError, api } from "../lib/auth";
import { scopeWords } from "../lib/oauth";
import { useApi } from "../lib/useApi";
import { Card } from "./ui";

type Grants = { data: { id: string; clientName: string; scopes: string[]; createdAt: string }[] };

/** AI agents and apps the business has connected, with a way to cut each one off. */
export function ConnectedApps() {
  const grants = useApi<Grants>("/v1/oauth/grants");
  const [error, setError] = useState("");

  async function disconnect(id: string) {
    setError("");
    try {
      await api.delete(`/v1/oauth/grants/${id}`);
      grants.reload();
    } catch (e) {
      setError(e instanceof AuthError ? e.message : "The app could not be disconnected. Try again.");
    }
  }

  return (
    <Card title="Connected apps">
      {grants.data?.data.length === 0 && <p className="text-muted">No apps are connected. An AI agent you connect appears here.</p>}
      <ul className="divide-y divide-line" data-testid="connected-apps">
        {grants.data?.data.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <p className="font-medium">{g.clientName}</p>
              <p className="text-sm text-muted">{scopeWords(g.scopes).join(". ")}. Connected {g.createdAt.slice(0, 10)}.</p>
            </div>
            <button type="button" onClick={() => disconnect(g.id)} className="rounded border border-line px-3 py-1 text-sm hover:border-danger">Disconnect</button>
          </li>
        ))}
      </ul>
      {error && <p role="status" className="mt-2 text-sm text-danger">{error}</p>}
    </Card>
  );
}
