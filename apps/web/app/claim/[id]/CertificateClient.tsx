"use client";

import { useEffect, useState } from "react";
import { Badge, Card } from "../../../components/ui";
import { certificateFacts, certificateLinks, certificateStatus, type Certificate } from "../../../lib/certificate";
import { formatWhen } from "../../../lib/financingTimeline";
import { call } from "../../../lib/investor";

export default function CertificateClient({ id }: { id: string }) {
  const [cert, setCert] = useState<Certificate | null | "missing" | "error">(null);

  useEffect(() => {
    let alive = true;
    call<Certificate>("GET", `/public/claims/${encodeURIComponent(id)}`).then(
      (c) => alive && setCert(c),
      (e: { code?: string }) => alive && setCert(e.code === "not_found" ? "missing" : "error"),
    );
    return () => { alive = false; };
  }, [id]);

  if (cert === null) return <p role="status">Loading…</p>;
  if (cert === "missing") return <p role="status" data-testid="certificate-missing">We could not find a claim with this link.</p>;
  if (cert === "error") return <p role="status" data-testid="certificate-error">The certificate could not be loaded right now. Try again in a minute.</p>;

  const status = certificateStatus(cert);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold">Receivable certificate</h1>
        <p className="mt-1 text-muted">A claim on an unpaid invoice, checked against the blockchain each time this page opens.</p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="text-sm text-muted" data-testid="certificate-confirmation">
            {cert.confirmation.state === "confirmed" ? "Confirmed on the blockchain" : "Not confirmed by the blockchain"}
          </span>
        </div>
        <p className="mt-2 text-sm" data-testid="certificate-status">{status.explanation}</p>
        {cert.confirmation.state === "unconfirmed" && (
          <p className="mt-2 text-sm text-muted" data-testid="certificate-detail">
            Our records say &ldquo;{cert.confirmation.databaseStatus}&rdquo;; the blockchain says &ldquo;{cert.confirmation.onchainStatus ?? "unknown"}&rdquo;.
          </p>
        )}
      </Card>

      <Card title="The claim">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm" data-testid="certificate-facts">
          {certificateFacts(cert).map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted">{f.label}</dt>
              <dd className="amount break-all">{f.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Check it yourself">
        <ul className="flex flex-col gap-1 text-sm" data-testid="certificate-links">
          {certificateLinks(cert).map((l) => (
            <li key={l.label}><a href={l.url} target="_blank" rel="noreferrer" className="underline">{l.label}</a></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Listed {formatWhen(cert.times.listedAt)} · Funded {formatWhen(cert.times.fundedAt)}
          {cert.times.closedAt ? ` · Closed ${formatWhen(cert.times.closedAt)}` : ""}
        </p>
      </Card>

      <p className="text-xs text-muted">
        Test network. The invoice number is shown only if the business chose to share it. No customer details are ever shown here.
      </p>
    </div>
  );
}
