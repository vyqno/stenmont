export const EVENT_TYPES = [
  "invoice.created",
  "invoice.partially_paid",
  "invoice.paid",
  "refund.created",
  "invoice.cancelled",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
