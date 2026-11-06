/** Webhook events a business can pick, in plain words. Names match what the API sends. */
export const WEBHOOK_EVENT_GROUPS: { title: string; events: { id: string; label: string; on: boolean }[] }[] = [
  { title: "Invoices", events: [
    { id: "invoice.created", label: "Invoice created", on: true },
    { id: "invoice.partially_paid", label: "Invoice partly paid", on: true },
    { id: "invoice.paid", label: "Invoice paid", on: true },
    { id: "invoice.cancelled", label: "Invoice cancelled", on: true },
    { id: "invoice.reminder", label: "Payment reminder due", on: false },
    { id: "refund.created", label: "Refund made", on: true },
  ] },
  { title: "Subscriptions", events: [
    { id: "subscription.created", label: "Subscription started", on: false },
    { id: "subscription.charged", label: "Subscription charged", on: false },
    { id: "subscription.past_due", label: "Subscription payment failed", on: false },
    { id: "subscription.at_risk", label: "Subscription at risk", on: false },
    { id: "subscription.cancelled", label: "Subscription cancelled", on: false },
  ] },
  { title: "Pay in instalments", events: [
    { id: "instalment.started", label: "Plan started", on: false },
    { id: "instalment.charged", label: "Instalment paid", on: false },
    { id: "instalment.failed", label: "Instalment failed", on: false },
    { id: "instalment.completed", label: "Plan completed", on: false },
    { id: "instalment.cancelled", label: "Plan cancelled", on: false },
  ] },
  { title: "Selling invoices early", events: [
    { id: "claim.funded", label: "Invoice funded", on: false },
    { id: "claim.settled", label: "Funded invoice settled", on: false },
    { id: "claim.defaulted", label: "Funded invoice defaulted", on: false },
  ] },
];

export const defaultWebhookEvents = () => WEBHOOK_EVENT_GROUPS.flatMap((g) => g.events).filter((e) => e.on).map((e) => e.id);

/** A plain-words reason the address cannot be used, or null. The server checks again; this saves a round trip. */
export function webhookUrlProblem(raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Enter the address that should receive events.";
  let u: URL;
  try { u = new URL(value); } catch { return "That is not a full web address. Start with https://"; }
  if (u.protocol !== "https:") return "The address must start with https://";
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.startsWith("[") || /^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return "The address must be public. Private and local addresses cannot receive events.";
  return null;
}
