import { drizzle } from "drizzle-orm/d1";
import { invoices, webhookEndpoints } from "../../src/db/schema";
import { MERCHANT_ADDRESS } from "./app";
import { invoiceId } from "@stenmont/shared";

export const dbOf = (d1: D1Database) => drizzle(d1);

export async function seedInvoice(d1: D1Database, number = "INV-1", amount = 10_000_000n, merchantId = "m_1") {
  const id = invoiceId(MERCHANT_ADDRESS, number);
  const now = new Date().toISOString();
  await dbOf(d1).insert(invoices).values({
    id,
    merchantId,
    number,
    status: "open",
    amount: amount.toString(),
    metaHash: `0x${"0".repeat(64)}`,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function seedEndpoint(d1: D1Database, opts: { merchantId?: string; url?: string; events?: string[]; secret?: string; id?: string } = {}) {
  const id = opts.id ?? crypto.randomUUID();
  await dbOf(d1).insert(webhookEndpoints).values({
    id,
    merchantId: opts.merchantId ?? "m_1",
    url: opts.url ?? "https://shop.example/hooks",
    secret: opts.secret ?? "whsec_test",
    events: JSON.stringify(opts.events ?? []),
    createdAt: new Date().toISOString(),
  });
  return id;
}

export function fakeQueue() {
  const sent: { deliveryId: string }[] = [];
  return { sent, send: async (m: { deliveryId: string }) => void sent.push(m) };
}
