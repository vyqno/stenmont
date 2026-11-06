import { fromUnits } from "@stenmont/shared";
import type { invoices } from "../db/schema";
import type { Env } from "../env";

export type InvoiceRow = typeof invoices.$inferSelect;

export function invoiceView(r: InvoiceRow, env: Pick<Env, "APP_URL">) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    amount: fromUnits(BigInt(r.amount)),
    amountPaid: fromUnits(BigInt(r.amountPaid)),
    amountRefunded: fromUnits(BigInt(r.amountRefunded)),
    currency: r.currency,
    customerEmail: r.customerEmail,
    dueDate: r.dueDate,
    taxRate: r.taxRateBps,
    taxLabel: r.taxLabel,
    metadata: JSON.parse(r.metadata) as Record<string, string>,
    createTxHash: r.createTxHash,
    successUrl: r.successUrl,
    cancelUrl: r.cancelUrl,
    payUrl: `${env.APP_URL}/pay/${r.id}`,
    createdAt: r.createdAt,
  };
}
