import { BUSINESS_LABEL, toUnits } from "@stenmont/shared";

export type Availability = { label: string; available: boolean };
export type BusinessName = { name: string; resolver: string; payoutLocked: boolean; status: string };
export type Agent = { label: string; name: string; agentAddress: string; scopes: string[]; dailyLimit: string; perTxLimit: string; expiresAt: string; status: string };
export const AGENT_SCOPES = ["pay", "invoice.read", "refund.draft"] as const;
export type AgentForm = { label: string; agentAddress: string; dailyLimit: string; perTxLimit: string; expiresInDays: string; scopes: string[]; context: string; endpoint: string };
export type AgentInput = Omit<AgentForm, "expiresInDays" | "endpoint"> & { expiresInDays: number; endpoint?: string };

export function canClaimLabel(label: string, checked: Availability | null): boolean {
  return BUSINESS_LABEL.test(label) && checked?.label === label && checked.available;
}

/** Validate before spending the user's time on a request; the server remains authoritative. */
export function parseAgentInput(form: AgentForm): AgentInput | null {
  if (!BUSINESS_LABEL.test(form.label) || !/^0x[0-9a-fA-F]{40}$/.test(form.agentAddress)) return null;
  if (![form.dailyLimit, form.perTxLimit].every((v) => /^\d+(\.\d{1,6})?$/.test(v))) return null;
  try {
    if (toUnits(form.perTxLimit) <= 0n || toUnits(form.dailyLimit) < toUnits(form.perTxLimit)) return null;
  } catch { return null; }
  const days = Number(form.expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > 365 || !form.scopes.length || form.scopes.some((s) => !(AGENT_SCOPES as readonly string[]).includes(s)) || new Set(form.scopes).size !== form.scopes.length || form.context.length > 500) return null;
  if (form.endpoint) {
    try {
      const u = new URL(form.endpoint);
      if (u.protocol !== "https:" || u.username || u.password || form.endpoint.length > 2048) return null;
    } catch { return null; }
  }
  return { ...form, expiresInDays: days, endpoint: form.endpoint || undefined };
}

/** Must match the exact four fields required by the existing server approval gate. */
export function agentApprovalParams(input: AgentInput) {
  return { label: input.label, agentAddress: input.agentAddress, dailyLimit: input.dailyLimit, perTxLimit: input.perTxLimit };
}
