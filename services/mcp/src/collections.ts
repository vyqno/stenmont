import { z } from "zod";
import type { Tool } from "./index";
const invoiceId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/** These tools only read or queue a draft. Merchant decisions are deliberately absent from the MCP surface. */
export function collectionTools(appUrl: string): Tool[] {
  return [
    { name: "list_overdue", description: "List overdue invoices belonging to this business. Read only.", schema: z.strictObject({}), inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run(_a, api) {
        const response = await api("/v1/collections/overdue");
        return { content: [{ type: "text", text: JSON.stringify(await response.json()) }], ...(!response.ok ? { isError: true } : {}) };
      } },
    ...(["draft_reminder", "propose_plan"] as const).map((name): Tool => ({
      name, description: name === "draft_reminder" ? "Queue a fixed-text reminder for merchant review. No email is sent." : "Draft a B2B payment plan of two or three parts. Outside policy requires a matching World approval; a merchant must still review. No agreement or email is created.",
      schema: name === "draft_reminder" ? z.strictObject({ invoiceId }) : z.strictObject({ invoiceId, instalments: z.number().int().min(2).max(3), b2b: z.literal(true), payerBusinessName: z.string().trim().min(2).max(200), extensionDays: z.number().int().min(0).max(366).optional() }),
      inputSchema: { type: "object", properties: { invoiceId: { type: "string" }, ...(name === "propose_plan" ? { instalments: { type: "integer", minimum: 2, maximum: 3 }, b2b: { const: true }, payerBusinessName: { type: "string" }, extensionDays: { type: "integer", minimum: 0, maximum: 366 } } : {}) }, required: name === "draft_reminder" ? ["invoiceId"] : ["invoiceId", "instalments", "b2b", "payerBusinessName"], additionalProperties: false },
      async run(args, api) {
        const post = (path: string, body: unknown) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const response = await post(`/v1/collections/${name === "draft_reminder" ? "reminders" : "plans"}`, args);
        const body = await response.json() as any;
        if (body.error?.code === "approval_required" && body.error.details?.approvalParams) {
          const approval = await post("/v1/approvals", { operation: "collections_exception", params: body.error.details.approvalParams });
          const result = await approval.json() as any;
          return { content: [{ type: "text", text: approval.ok ? `World approval required: ${result.authorizeUrl}. Nothing was drafted or sent. After approval, retry with the same terms.` : JSON.stringify(result) }], ...(!approval.ok ? { isError: true } : {}) };
        }
        return { content: [{ type: "text", text: response.ok ? `Draft queued: ${JSON.stringify(body)}. Review at ${appUrl}/dashboard/collections. Nothing sent.` : JSON.stringify(body) }], ...(!response.ok ? { isError: true } : {}) };
      },
    })),
  ];
}
