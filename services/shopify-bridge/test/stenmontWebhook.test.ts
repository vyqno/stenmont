import { signWebhook } from "@stenmont/sdk";
import { describe, expect, it } from "vitest";
import { createApp } from "../src";
import { world } from "./fakes";
import { env, fake } from "./helpers";

const D = "gid://shopify/DraftOrder/101";
const TX = "0x" + "ab".repeat(32);
const SECRET = fake("stenmont_whsec");

const evt = (type: string, over: any = {}, meta: any = { shop: "demo-shop.myshopify.com", draftOrderId: D }) => ({
  id: over.id ?? "evt_1",
  type,
  created: 1,
  livemode: false,
  data: { invoice: { id: "0xinv1", amount: "10.00", metadata: meta, ...over.invoice }, payment: { txHash: TX }, refund: { to: "0x1", value: "4.00", txHash: "0x" + "cd".repeat(32) }, ...over.data },
});
async function send(app: ReturnType<typeof createApp>, e: ReturnType<typeof env>, body: unknown, opts: { secret?: string; t?: number; sig?: string } = {}) {
  const raw = JSON.stringify(body);
  const sig = opts.sig ?? (await signWebhook(opts.secret ?? SECRET, raw, opts.t));
  return app.request("/webhooks/stenmont", { method: "POST", headers: { "stenmont-signature": sig }, body: raw }, e);
}

describe("POST /webhooks/stenmont", () => {
  it("completes the draft order, records the named manual payment, tags it and notes the invoice and explorer link", async () => {
    const w = world({ drafts: { [D]: {} } });
    const e = env();
    const res = await send(createApp(w.d), e, evt("invoice.paid"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status).toBe("done");
    const order = [...w.state.orders.values()][0]!;
    expect(order.status).toBe("PAID");
    expect(order.gateway).toBe("Pay with USDT (Stenmont)");
    expect(order.tags).toEqual(["stenmont", "stenmont-paid"]);
    expect(order.note).toContain("Invoice 0xinv1.");
    expect(order.note).toContain(`https://explorer.testnet.whitechain.io/tx/${TX}`);
  });

  it("changes nothing on a replayed webhook (same event, and a new event for the same invoice)", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const e = env();
    await send(app, e, evt("invoice.paid"));
    const before = [...w.state.ops];
    const again = await send(app, e, evt("invoice.paid"));
    expect(((await again.json()) as any).reason).toBe("duplicate_event");
    const other = await send(app, e, evt("invoice.paid", { id: "evt_2" }));
    expect(((await other.json()) as any).status).toBe("already_done");
    expect(w.state.ops).toEqual(before);
    expect(w.state.orders.size).toBe(1);
  });

  it("falls back to mark-as-paid when Shopify refuses the named payment", async () => {
    const w = world({ drafts: { [D]: {} }, manualRejected: true });
    await send(createApp(w.d), env(), evt("invoice.paid"));
    expect([...w.state.orders.values()][0]!.status).toBe("PAID");
    expect(w.state.ops).toContain("markpaid");
  });

  it("does not record a second payment when the order is already paid", async () => {
    const w = world({ drafts: { [D]: {} }, completeAsPaid: true });
    await send(createApp(w.d), env(), evt("invoice.paid"));
    expect(w.state.ops).not.toContain("manual");
    expect(w.state.ops).not.toContain("markpaid");
  });

  it("resumes safely after a half-finished run without completing twice", async () => {
    const w = world({ drafts: { [D]: {} } });
    const e = env();
    // first run dies after completing the draft: the note step fails
    const real = w.d.fetch;
    let fail = true;
    w.d.fetch = (async (url: any, init: any) => {
      if (fail && String(init?.body).includes("orderUpdate")) return new Response("x", { status: 500 });
      return real(url, init);
    }) as typeof fetch;
    const app = createApp(w.d);
    expect((await send(app, e, evt("invoice.paid"))).status).toBe(502);
    fail = false;
    expect((await send(app, e, evt("invoice.paid", { id: "evt_retry" }))).status).toBe(200);
    expect(w.state.ops.filter((o) => o === "complete").length).toBe(1);
    expect(w.state.orders.size).toBe(1);
  });

  it("does not touch a draft that someone else completed, or whose price changed after the invoice", async () => {
    const w = world({ drafts: { [D]: { status: "COMPLETED", order: "gid://shopify/Order/5" } } });
    const e = env();
    const a: any = await (await send(createApp(w.d), e, evt("invoice.paid"))).json();
    expect(a).toMatchObject({ status: "needs_review", reason: "draft_completed_elsewhere" });
    const w2 = world({ drafts: { [D]: { amount: "99.00" } } });
    const b: any = await (await send(createApp(w2.d), env(), evt("invoice.paid"))).json();
    expect(b).toMatchObject({ status: "needs_review", reason: "price_changed" });
    expect(w2.state.orders.size).toBe(0);
  });

  it("refuses a missing, wrong, tampered or stale signature and does nothing", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const body = evt("invoice.paid");
    expect((await app.request("/webhooks/stenmont", { method: "POST", body: JSON.stringify(body) }, env())).status).toBe(401);
    expect((await send(app, env(), body, { secret: "wrong" })).status).toBe(401);
    expect((await send(app, env(), body, { sig: "t=1,v1=00" })).status).toBe(401);
    expect((await send(app, env(), body, { t: 1_000 })).status).toBe(401); // replayed long ago
    const raw = JSON.stringify(body);
    const sig = await signWebhook(SECRET, raw);
    expect((await app.request("/webhooks/stenmont", { method: "POST", headers: { "stenmont-signature": sig }, body: raw.replace("10.00", "0.01") }, env())).status).toBe(401);
    expect(w.calls.length).toBe(0);
  });

  it("ignores events for another shop or other types", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const other: any = await (await send(app, env(), evt("invoice.paid", {}, { shop: "other.myshopify.com", draftOrderId: D }))).json();
    expect(other).toMatchObject({ status: "ignored", reason: "not_ours" });
    const created: any = await (await send(app, env(), evt("invoice.created", { id: "evt_9" }))).json();
    expect(created.status).toBe("ignored");
    expect(w.calls.length).toBe(0);
  });

  it("on refund adds a tag and a note, and does not refund in Shopify", async () => {
    const w = world({ drafts: { [D]: {} } });
    const app = createApp(w.d);
    const e = env();
    await send(app, e, evt("invoice.paid"));
    const r = await send(app, e, evt("refund.created", { id: "evt_r1" }));
    expect(((await r.json()) as any).status).toBe("done");
    const order = [...w.state.orders.values()][0]!;
    expect(order.tags).toContain("stenmont-refunded");
    expect(order.note).toContain("refund of 4.00 USDT");
    expect(order.status).toBe("PAID");
    expect(w.calls.map((c) => c.body?.query ?? "").join("\n")).not.toMatch(/refundCreate|orderCancel/);
    // a second delivery of the same refund adds nothing
    const noteBefore = order.note;
    await send(app, e, evt("refund.created", { id: "evt_r2" }));
    expect(order.note).toBe(noteBefore);
  });

  it("ignores a refund for an invoice that never reached an order", async () => {
    const w = world({ drafts: { [D]: {} } });
    const out: any = await (await send(createApp(w.d), env(), evt("refund.created"))).json();
    expect(out).toMatchObject({ status: "ignored", reason: "no_order" });
  });
});
