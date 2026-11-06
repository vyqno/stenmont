import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthError } from "../lib/auth";
import { refundApprovalState, refundApprovalPayload } from "../lib/refundApproval";
import { RefundApprovalPrompt } from "../components/RefundButton";
const invoiceId = `0x${"12".repeat(32)}`;
const params = { invoiceId, amount: "2.010000", to: "0x4444444444444444444444444444444444444444" };
describe("fresh World approval for the same refund", () => {
  it.each(["approval_denied", "approval_expired", "approval_required"])("keeps exact parameters after %s and requests the normal approval path", code => {
    const state = refundApprovalState(new AuthError(code, "Not approved", { approvalParams: params }), invoiceId);
    expect(state?.params).toEqual(params);
    expect(refundApprovalPayload(state!.params)).toEqual({ operation: "refund", params });
    expect(JSON.parse(JSON.stringify(refundApprovalPayload(state!.params))).params.amount).toBe("2.010000");
  });
  it.each(["approval_denied", "approval_expired"])("shows an explicit fresh approval action after %s", code => {
    const state = refundApprovalState(new AuthError(code, "Not approved", { approvalParams: params }), invoiceId)!;
    const html = renderToStaticMarkup(<RefundApprovalPrompt params={state.params} reason={state.reason} busy={false} onApprove={() => {}} />);
    expect(html).toContain("Request fresh World approval");
    expect(html).toContain("Nothing was refunded");
    expect(html).not.toContain("Refund sent");
  });
  it("never reuses parameters for another invoice or a signature/approval mismatch", () => {
    expect(refundApprovalState(new AuthError("approval_denied", "Denied", { approvalParams: { ...params, invoiceId: "other" } }), invoiceId)).toBeNull();
    expect(refundApprovalState(new AuthError("approval_mismatch", "Mismatch", { approvalParams: params }), invoiceId)).toBeNull();
    expect(refundApprovalState(new AuthError("approval_denied", "Denied"), invoiceId)).toBeNull();
  });
});
