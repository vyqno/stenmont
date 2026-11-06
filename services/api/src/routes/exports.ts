import { and, asc, eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { invoices, payments, refunds } from "../db/schema";
import { cell, row } from "../lib/csv";
import { invalid } from "../lib/validation";

const EXPLORER = "https://explorer.testnet.whitechain.io/tx/";
const MAX_ROWS = 20_000;

const realDay = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`); // NaN for 2026-13-40; zod runs refinements even after the regex fails, so never throw here
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
};
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDay, "not a real date");
const query = z
  .object({ from: day.optional(), to: day.optional(), format: z.enum(["generic", "quickbooks"]).default("generic") })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must not be after to", path: ["from"] });

const money = (units: bigint, sign: 1n | -1n) => {
  const v = units * sign;
  return `${v < 0n ? "-" : ""}${fromUnits(v < 0n ? -v : v).replace(/^(\d+)$/, "$1.00").replace(/^(\d+\.\d)$/, "$10")}`;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const exportRoutes = new Hono<AppEnv>();

/** What an accountant needs: every payment in and refund out, signed, one line each. Dates are when we recorded the event. */
exportRoutes.get("/payments.csv", async (c) => {
  const parsed = query.safeParse(c.req.query());
  if (!parsed.success) return invalid(c, parsed.error);
  const { from, to, format } = parsed.data;
  const db = c.var.db;
  const range = (col: typeof payments.createdAt | typeof refunds.createdAt) => [
    ...(from ? [gte(col, `${from}T00:00:00.000Z`)] : []),
    ...(to ? [lt(col, new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString())] : []),
  ];

  const pays = await db
    .select({ at: payments.createdAt, who: payments.payer, value: payments.value, tx: payments.txHash, number: invoices.number, email: invoices.customerEmail })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(and(eq(invoices.merchantId, c.var.merchantId), ...range(payments.createdAt)))
    .orderBy(asc(payments.createdAt), asc(payments.id))
    .limit(MAX_ROWS);
  const refs = await db
    .select({ at: refunds.createdAt, who: refunds.toAddress, value: refunds.value, tx: refunds.txHash, number: invoices.number, email: invoices.customerEmail })
    .from(refunds)
    .innerJoin(invoices, eq(invoices.id, refunds.invoiceId))
    .where(and(eq(invoices.merchantId, c.var.merchantId), ...range(refunds.createdAt)))
    .orderBy(asc(refunds.createdAt), asc(refunds.id))
    .limit(MAX_ROWS);

  const lines = [
    ...pays.map((r) => ({ ...r, type: "payment" as const, sign: 1n as const })),
    ...refs.map((r) => ({ ...r, type: "refund" as const, sign: -1n as const })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const header = format === "quickbooks" ? "Date,Description,Amount" : "date,type,invoice,customer,counterparty,amount,currency,tx_hash,explorer_url";
  const body = lines.map((l) => {
    const amount = money(BigInt(l.value), l.sign);
    if (format === "quickbooks") {
      const [y, m, d] = l.at.slice(0, 10).split("-");
      const what = l.type === "payment" ? `Payment ${l.number} from ${short(l.who)}` : `Refund ${l.number} to ${short(l.who)}`;
      return row([`${m}/${d}/${y}`, cell(what), amount]);
    }
    return row([l.at, l.type, cell(l.number), cell(l.email ?? ""), l.who, amount, "USDT", l.tx, EXPLORER + l.tx]);
  });
  const name = `stenmont-payments-${from ?? "start"}-to-${to ?? "now"}.csv`;
  return new Response([header, ...body].join("\r\n") + "\r\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" },
  });
});
