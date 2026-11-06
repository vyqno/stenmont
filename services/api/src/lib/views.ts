import { fromUnits } from "@stenmont/shared";
import type { invoices } from "../db/schema";
import type { Env } from "../env";

export type InvoiceRow = typeof invoices.$inferSelect;

export function invoiceView(r: InvoiceRow, env: Pick<Env,"APP_URL"> & Partial<Env>) {
  const unassigned=r.status==='failed'&&!r.createTxHash&&!r.routerAddress;
  return {
    id: r.id,
    contractVersion:r.contractVersion,routerAddress:unassigned?null:r.routerAddress??env.ROUTER_ADDRESS,claimAddress:unassigned?null:r.claimAddress??(r.routerAddress&&r.routerAddress.toLowerCase()!==env.ROUTER_ADDRESS?.toLowerCase()?null:env.INVOICE_CLAIM_ADDRESS),
    payout:r.payout,payerLock:r.payerLock,minPayment:fromUnits(BigInt(r.minPayment)),discountBps:r.discountBps,discountUntil:r.discountUntil,hook:r.hook,
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
