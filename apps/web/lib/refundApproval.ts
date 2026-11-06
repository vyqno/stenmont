import { AuthError } from "./auth";
export type ApprovalParams = { invoiceId: string; amount: string; to: string };
export type ApprovalReason = "approval_required" | "approval_denied" | "approval_expired";
/** A refusal never authorizes a refund: it offers only a new normal World approval for the exact server-bound operation. */
export function refundApprovalState(error: unknown, invoiceId: string): { params: ApprovalParams; reason: ApprovalReason } | null {
  if (!(error instanceof AuthError) || !["approval_required", "approval_denied", "approval_expired"].includes(error.code)) return null;
  const params = (error.details as { approvalParams?: ApprovalParams } | undefined)?.approvalParams;
  if (!params || params.invoiceId !== invoiceId || typeof params.amount !== "string" || !/^\d+(\.\d{1,6})?$/.test(params.amount) || !/^0x[0-9a-fA-F]{40}$/.test(params.to)) return null;
  return { params: { invoiceId: params.invoiceId, amount: params.amount, to: params.to }, reason: error.code as ApprovalReason };
}
export const refundApprovalPayload = (params: ApprovalParams) => ({ operation: "refund" as const, params });
