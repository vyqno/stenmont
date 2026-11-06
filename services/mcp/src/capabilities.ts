import { z } from "zod";

export type McpConfig = { apiUrl: string; appUrl: string; fetch: typeof fetch };
type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): Out => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

const id = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "an invoice id is 0x followed by 64 hex characters");
const amount = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, "an amount like 12.50");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "a date like 2026-11-30");

export type Tool = { name: string; description: string; inputSchema: object; schema: z.ZodType; run: (a: any, api: Api) => Promise<Out> };
export type Api = (path: string, init?: RequestInit) => Promise<Response>;

const apiError = async (res: Response) => {
  const body: any = await res.json().catch(() => null);
  const err = body?.error ?? { code: "http_" + res.status, message: `The request failed (${res.status}).` };
  // The API names the permission that is missing; the agent can only fix it by asking the person to connect again.
  return err.code === "insufficient_scope" ? { ...err, message: `${err.message}. Ask the person to reconnect Stenmont and allow it.` } : err;
};
const fmt = (v: unknown) => JSON.stringify(v, null, 2);

export function createTools(cfg: McpConfig): Tool[] {
  return [
    {
      name: "list_invoices",
      description: "List the business's invoices, newest first. Optionally filter by status (open, partially_paid, paid, cancelled, failed).",
      inputSchema: { type: "object", properties: { status: { type: "string", enum: ["open", "partially_paid", "paid", "cancelled", "failed"] }, limit: { type: "integer", minimum: 1, maximum: 100 } } },
      schema: z.strictObject({ status: z.enum(["open", "partially_paid", "paid", "cancelled", "failed"]).optional(), limit: z.number().int().min(1).max(100).optional() }),
      async run(a, api) {
        const q = new URLSearchParams({ limit: String(a.limit ?? 25) });
        if (a.status) q.set("status", a.status);
        const res = await api(`/v1/invoices?${q}`);
        if (!res.ok) return text((await apiError(res)).message, true);
        return text(fmt(await res.json()));
      },
    },
    {
      name: "get_invoice",
      description: "Get one invoice by its id: amount, status, how much has been paid and refunded, and its payment link.",
      inputSchema: { type: "object", properties: { id: { type: "string", description: "0x followed by 64 hex characters" } }, required: ["id"] },
      schema: z.strictObject({ id }),
      async run(a, api) {
        const res = await api(`/v1/invoices/${a.id}`);
        if (!res.ok) return text((await apiError(res)).message, true);
        return text(fmt(await res.json()));
      },
    },
    {
      name: "export_payments",
      description: "Export every payment received and refund sent between two dates as CSV for the accountant. Format is generic or quickbooks.",
      inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, format: { type: "string", enum: ["generic", "quickbooks"] } }, required: ["from", "to"] },
      schema: z.strictObject({ from: day, to: day, format: z.enum(["generic", "quickbooks"]).optional() }),
      async run(a, api) {
        const q = new URLSearchParams({ from: a.from, to: a.to });
        if (a.format) q.set("format", a.format);
        const res = await api(`/v1/exports/payments.csv?${q}`);
        if (!res.ok) return text((await apiError(res)).message, true);
        return text(await res.text());
      },
    },
    {
      name: "draft_refund",
      description:
        "Prepare a refund for an invoice. This NEVER sends money: it creates a pending request that a person must confirm with their passkey in the dashboard (large refunds also need a World approval, and this returns that link). Amount defaults to everything refundable.",
      inputSchema: { type: "object", properties: { invoiceId: { type: "string" }, amount: { type: "string", description: "e.g. 2.50" }, to: { type: "string", description: "payer address, only if several payers" } }, required: ["invoiceId"] },
      schema: z.strictObject({ invoiceId: id, amount: amount.optional(), to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional() }),
      async run(a, api) {
        const body = { invoiceId: a.invoiceId, ...(a.amount ? { amount: a.amount } : {}), ...(a.to ? { to: a.to } : {}) };
        const post = (path: string, b: unknown) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
        const res = await post("/v1/refunds", body);
        const dash = `${cfg.appUrl}/dashboard/invoices`;
        if (res.ok) {
          const r: any = await res.json();
          return text(`Refund drafted: ${r.amount ?? ""} on invoice ${a.invoiceId} (request ${r.id}). Nothing has been sent. A person must open ${dash} and confirm it with their passkey; the request expires in an hour.`);
        }
        const err = await apiError(res);
        if (err.code === "approval_required" && err.details?.approvalParams) {
          const ap = await post("/v1/approvals", { operation: "refund", params: err.details.approvalParams });
          if (!ap.ok) return text((await apiError(ap)).message, true);
          const a2: any = await ap.json();
          return text(`This refund is large, so a person must approve it with World first: ${a2.authorizeUrl}\nNothing has been sent. After approving, run draft_refund again, then confirm it with a passkey at ${dash}.`);
        }
        return text(err.message, true);
      },
    },
  ];
}
