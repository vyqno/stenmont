import { Card } from "../../../components/ui";
import { scopeWords } from "../../../lib/oauth";

export type ConsentProps = {
  client: { name: string };
  redirectHost: string;
  scopes: string[];
  business: string;
  busy: boolean;
  onDecide: (decision: "approve" | "deny") => void;
};

export function ConsentView({ client, redirectHost, scopes, business, busy, onDecide }: ConsentProps) {
  return (
    <Card title={`Connect ${client.name}?`}>
      <p>
        <strong>{client.name}</strong> wants to act for <strong>{business}</strong>. After you decide, you go back to <code className="font-mono">{redirectHost}</code>.
      </p>
      <p className="mt-3 text-sm text-muted">It will be able to:</p>
      <ul className="mt-1 list-disc pl-5" data-testid="permissions">
        {scopeWords(scopes).map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">It can never confirm a refund or move money. You can disconnect it any time in Settings.</p>
      <div className="mt-4 flex gap-3">
        <button type="button" disabled={busy} onClick={() => onDecide("approve")} className="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50">
          Approve
        </button>
        <button type="button" disabled={busy} onClick={() => onDecide("deny")} className="rounded border border-line px-4 py-2 hover:border-danger disabled:opacity-50">
          Deny
        </button>
      </div>
    </Card>
  );
}
