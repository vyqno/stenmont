import { deps, type Call } from "./helpers";

type DraftFixture = { id?: string; name?: string; status?: string; amount?: string; currency?: string; order?: string | null; lines?: number; email?: string | null };

/** A pretend Shopify Admin API and a pretend Stenmont API behind one fetch. Nothing touches the network. */
export function world(opts: { drafts?: Record<string, DraftFixture>; shopifyErrors?: Record<string, any>; stenmontStatus?: number } = {}) {
  const calls: Call[] = [];
  const drafts = opts.drafts ?? {};
  const state = { invoices: new Map<string, any>(), created: 0, sent: [] as any[], createdDrafts: [] as any[] };
  const handler = (c: Call): Response => {
    if (c.url.includes("/admin/api/")) {
      const q: string = c.body.query;
      const v = c.body.variables ?? {};
      const err = Object.entries(opts.shopifyErrors ?? {}).find(([k]) => q.includes(k));
      if (err) return Response.json({ data: { [err[0]]: err[1] } });
      if (q.includes("query Draft(")) {
        const d = drafts[v.id];
        if (!d) return Response.json({ data: { draftOrder: null } });
        return Response.json({ data: { draftOrder: { id: v.id, name: d.name ?? "#D1", status: d.status ?? "OPEN", totalPriceSet: { shopMoney: { amount: d.amount ?? "10.00", currencyCode: d.currency ?? "USD" } }, order: d.order ? { id: d.order } : null, lineItems: { nodes: d.lines === 0 ? [] : [{ id: "gid://shopify/DraftOrderLineItem/1" }] } } } });
      }
      if (q.includes("draftOrderCreate")) {
        state.createdDrafts.push(v.input);
        const id = `gid://shopify/DraftOrder/${900 + state.createdDrafts.length}`;
        drafts[id] = { amount: "20.00", currency: "USD" };
        return Response.json({ data: { draftOrderCreate: { draftOrder: { id }, userErrors: [] } } });
      }
      if (q.includes("draftOrderInvoiceSend")) {
        state.sent.push(v);
        return Response.json({ data: { draftOrderInvoiceSend: { draftOrder: { id: v.id }, userErrors: [] } } });
      }
      return Response.json({ errors: [{ message: "unexpected query in test" }] });
    }
    if (c.url.startsWith("https://api.stenmont.test/v1/invoices")) {
      if (opts.stenmontStatus) return Response.json({ error: { code: "boom", message: "internal secret text" } }, { status: opts.stenmontStatus });
      const key = c.headers.get("idempotency-key")!;
      if (!state.invoices.has(key)) {
        state.created++;
        state.invoices.set(key, { id: `0xinv${state.created}`, payUrl: `https://app.stenmont.test/pay/0xinv${state.created}` });
      }
      return Response.json(state.invoices.get(key), { status: 201 });
    }
    return new Response("unexpected url", { status: 500 });
  };
  return { calls, state, drafts, d: deps(handler, calls) };
}
