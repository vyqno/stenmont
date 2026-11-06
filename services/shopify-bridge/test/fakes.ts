import { deps, type Call } from "./helpers";

type DraftFixture = { id?: string; name?: string; status?: string; amount?: string; currency?: string; order?: string | null; lines?: number; email?: string | null };

/** A pretend Shopify Admin API and a pretend Stenmont API behind one fetch. Nothing touches the network. */
export function world(opts: { drafts?: Record<string, DraftFixture>; shopifyErrors?: Record<string, any>; stenmontStatus?: number; completeAsPaid?: boolean; orders?: Record<string, Partial<{ amount: string; currency: string; status: string }>>; subs?: { id: string; topic: string; uri: string }[]; manualRejected?: boolean } = {}) {
  const calls: Call[] = [];
  const drafts = opts.drafts ?? {};
  const state = {
    invoices: new Map<string, any>(),
    created: 0,
    sent: [] as any[],
    createdDrafts: [] as any[],
    orders: new Map<string, { name: string; note: string | null; tags: string[]; status: string; amount: string; currency: string; gateway: string | null }>(),
    ops: [] as string[],
    subs: [...(opts.subs ?? [])],
  };
  for (const [id, o] of Object.entries(opts.orders ?? {})) state.orders.set(id, { name: "#2001", note: null, tags: [], status: "PENDING", amount: "10.00", currency: "USD", gateway: null, ...o });
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
      if (q.includes("draftOrderComplete")) {
        state.ops.push("complete");
        const d = drafts[v.id]!;
        const oid = `gid://shopify/Order/${700 + state.orders.size}`;
        state.orders.set(oid, { name: "#1001", note: null, tags: [], status: opts.completeAsPaid ? "PAID" : "PENDING", amount: d.amount ?? "10.00", currency: d.currency ?? "USD", gateway: null });
        d.status = "COMPLETED";
        d.order = oid;
        return Response.json({ data: { draftOrderComplete: { draftOrder: { id: v.id, order: { id: oid } }, userErrors: [] } } });
      }
      if (q.includes("query Order(")) {
        const o = state.orders.get(v.id);
        return Response.json({ data: { order: o ? { id: v.id, name: o.name, note: o.note, tags: o.tags, displayFinancialStatus: o.status, totalPriceSet: { shopMoney: { amount: o.amount, currencyCode: o.currency } } } : null } });
      }
      if (q.includes("orderCreateManualPayment")) {
        state.ops.push("manual");
        if (opts.manualRejected) return Response.json({ data: { orderCreateManualPayment: { order: null, userErrors: [{ field: null, message: "nope" }] } } });
        const o = state.orders.get(v.id)!;
        o.status = "PAID";
        o.gateway = v.name;
        return Response.json({ data: { orderCreateManualPayment: { order: { id: v.id }, userErrors: [] } } });
      }
      if (q.includes("orderMarkAsPaid")) {
        state.ops.push("markpaid");
        state.orders.get(v.input.id)!.status = "PAID";
        return Response.json({ data: { orderMarkAsPaid: { order: { id: v.input.id }, userErrors: [] } } });
      }
      if (q.includes("tagsAdd")) {
        state.ops.push("tags");
        const o = state.orders.get(v.id)!;
        for (const t of v.tags) if (!o.tags.includes(t)) o.tags.push(t);
        return Response.json({ data: { tagsAdd: { node: { id: v.id }, userErrors: [] } } });
      }
      if (q.includes("orderUpdate")) {
        state.ops.push("note");
        state.orders.get(v.input.id)!.note = v.input.note;
        return Response.json({ data: { orderUpdate: { order: { id: v.input.id }, userErrors: [] } } });
      }
      if (q.includes("webhookSubscriptions")) return Response.json({ data: { webhookSubscriptions: { nodes: state.subs.filter((x) => x.uri === v.uri) } } });
      if (q.includes("webhookSubscriptionCreate")) {
        state.ops.push(`sub:${v.topic}`);
        state.subs.push({ id: `gid://shopify/WebhookSubscription/${state.subs.length + 1}`, topic: v.topic, uri: v.uri });
        return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: "x" }, userErrors: [] } } });
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
