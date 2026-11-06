export const EVENT_TYPES = [
  "invoice.created",
  "invoice.partially_paid",
  "invoice.paid",
  "refund.created",
  "invoice.cancelled",
  "invoice.reminder",
  "subscription.created",
  "subscription.charged",
  "subscription.past_due",
  "subscription.cancelled",
  "claim.funded",
  "claim.settled",
  "claim.defaulted",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
