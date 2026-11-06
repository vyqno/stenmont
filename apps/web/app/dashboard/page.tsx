"use client";

import { useMemo, useState } from "react";
import { PageHeader, type Invoice } from "../../components/ui";
import { booksStatus, dueSoon, monthKey, nextSteps, openInvoices, previousMonthKey, receivedIn, siteStatus, type BooksMonth, type SubLite } from "../../lib/overview";
import type { Site, Switch } from "../../lib/sites";
import { usePart, type Part } from "../../lib/useApi";
import { OverviewView } from "./OverviewView";

/** Builds one part of the page from other parts. Loading or failure of any input carries through. */
function derive<A extends unknown[], T>(inputs: { [K in keyof A]: Part<A[K]> }, make: (...v: A) => T): Part<T> {
  const parts = inputs as Part<unknown>[];
  const bad = parts.find((x) => x.status === "error");
  if (bad) return bad as Part<T>;
  if (parts.some((x) => x.status === "loading")) return { status: "loading" };
  return { status: "ready", value: make(...(parts.map((x) => (x as { value: unknown }).value) as A)) };
}

export default function Overview() {
  const [now] = useState(() => Date.now());
  const date = useMemo(() => new Date(now), [now]);
  const invoices = usePart<{ data: Invoice[] }>("/v1/invoices?limit=100");
  const books = usePart<BooksMonth>(`/v1/books/${monthKey(date)}`);
  const lastMonth = usePart<BooksMonth>(`/v1/books/${previousMonthKey(date)}`);
  const subs = usePart<{ data: SubLite[] }>("/v1/subscriptions");
  const sites = usePart<{ data: Site[] }>("/v1/sites");
  const sw = usePart<Switch>("/v1/payment-switch");
  const agent = usePart<{ daily: number; monthly: number; limits: { daily: number; monthly: number } }>("/v1/agent/usage");
  const verification = usePart<{ tier: number }>("/v1/verification");
  const products = usePart<{ data: unknown[] }>("/v1/products?limit=1");
  const directory = usePart<{ publishedAt: string | null }>("/v1/ens/directory");

  // An unreadable part is "unknown" (null), never guessed as "not done".
  const val = <T,>(p: Part<T | null>): T | null => (p.status === "ready" ? p.value : null);
  const loading = [verification, products, directory, sites].some((p) => p.status === "loading");
  const steps: Part<ReturnType<typeof nextSteps>> = loading
    ? { status: "loading" }
    : {
        status: "ready",
        value: nextSteps({
          tier: verification.status === "ready" ? (val(verification)?.tier ?? 0) : null,
          siteReady: sites.status === "ready" ? (val(sites)?.data.some((s) => s.ready) ?? false) : null,
          products: products.status === "ready" ? (val(products)?.data.length ?? 0) : null,
          profilePublished: directory.status === "ready" ? !!val(directory)?.publishedAt : null,
        }),
      };
  // Last month is a nicety: if it cannot be read the card simply leaves it out.
  const previous: Part<BooksMonth | null> = lastMonth.status === "error" ? { status: "ready", value: null } : lastMonth;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" description="Where your business stands today, from your own records." />
      <OverviewView
        now={now}
        steps={steps}
        received={derive([books], (b) => (b ? receivedIn(b.snapshot.lines) : null))}
        invoices={derive([invoices], (i) => ({ rows: i?.data ?? [], ...openInvoices(i?.data ?? [], now) }))}
        due={derive([subs], (s) => dueSoon(s?.data ?? [], now))}
        site={derive([sites, sw], (s, w) => siteStatus(s?.data ?? [], w))}
        books={derive([books, previous], (cur, prev) => booksStatus(date, cur, prev))}
        agent={agent}
      />
    </div>
  );
}
