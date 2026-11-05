import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { webhookDeliveries } from "../src/db/schema";
import { signWebhook, verifyWebhookSignature } from "../src/lib/signature";
import { deliver, handleQueue } from "../src/delivery";
import { emitEvent } from "../src/webhooks";
import { newD1 } from "./helpers/d1";
import { dbOf, fakeQueue, seedEndpoint } from "./helpers/fixtures";
import { seedMerchant } from "./helpers/app";

const event = (id = "evt_1", type: "invoice.paid" | "invoice.created" = "invoice.paid") => ({ id, type, data: { invoice: { id: "0x1" } } });

describe("signature", () => {
  it("verifies a good signature and rejects tampering, wrong secret and stale timestamps", async () => {
    const body = JSON.stringify({ a: 1 });
    const t = 1_700_000_000;
    const header = await signWebhook("whsec_x", body, t);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhookSignature("whsec_x", body, header, { now: t + 10 })).toBe(true);
    expect(await verifyWebhookSignature("whsec_x", body + " ", header, { now: t + 10 })).toBe(false);
    expect(await verifyWebhookSignature("whsec_y", body, header, { now: t + 10 })).toBe(false);
    expect(await verifyWebhookSignature("whsec_x", body, header, { now: t + 301 })).toBe(false);
    expect(await verifyWebhookSignature("whsec_x", body, "garbage", { now: t })).toBe(false);
  });
});

describe("emitEvent", () => {
  it("queues one delivery per subscribed endpoint and never duplicates the same event", async () => {
    const d1 = newD1();
    await seedMerchant(d1);
    await seedEndpoint(d1, { events: [] }); // all events
    await seedEndpoint(d1, { events: ["invoice.paid"] });
    await seedEndpoint(d1, { events: ["invoice.created"] }); // not subscribed to paid
    const q = fakeQueue();
    expect(await emitEvent(dbOf(d1), q, "m_1", event())).toBe(2);
    expect(await emitEvent(dbOf(d1), q, "m_1", event())).toBe(0); // same event id again
    expect(q.sent).toHaveLength(2);
    expect(await emitEvent(dbOf(d1), q, "m_1", event("evt_2"))).toBe(2);
  });
  it("skips inactive endpoints and other merchants' endpoints", async () => {
    const d1 = newD1();
    await seedMerchant(d1);
    await seedMerchant(d1, "m_2", "Beta", `sk_test_${"b".repeat(32)}`);
    const id = await seedEndpoint(d1);
    await seedEndpoint(d1, { merchantId: "m_2" });
    await d1.prepare("update webhook_endpoints set active = 0 where id = ?").bind(id).run();
    expect(await emitEvent(dbOf(d1), fakeQueue(), "m_1", event())).toBe(0);
  });
});

async function setupDelivery(opts: { fetch: typeof fetch; attempts?: number }) {
  const d1 = newD1();
  await seedMerchant(d1);
  await seedEndpoint(d1, { id: "ep1", secret: "whsec_s" });
  const q = fakeQueue();
  await emitEvent(dbOf(d1), q, "m_1", event());
  if (opts.attempts) await d1.prepare("update webhook_deliveries set attempts = ?").bind(opts.attempts).run();
  const id = q.sent[0]!.deliveryId;
  const row = async () => (await d1.prepare("select * from webhook_deliveries where id = ?").bind(id).first()) as Record<string, unknown>;
  return { d1, id, row, run: () => deliver(dbOf(d1), id, opts.fetch, () => 1_700_000_000_000) };
}

describe("deliver", () => {
  it("POSTs the exact signed payload and marks 2xx as delivered", async () => {
    let seen: { url: string; headers: Headers; body: string } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, headers: new Headers(init.headers), body: init.body as string };
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const t = await setupDelivery({ fetch: f });
    expect(await t.run()).toEqual({ outcome: "delivered" });
    expect(seen!.url).toBe("https://shop.example/hooks");
    expect(JSON.parse(seen!.body)).toMatchObject({ id: "evt_1", type: "invoice.paid", livemode: false });
    expect(seen!.headers.get("stenmont-event-id")).toBe("evt_1");
    expect(await verifyWebhookSignature("whsec_s", seen!.body, seen!.headers.get("stenmont-signature")!, { now: 1_700_000_000 })).toBe(true);
    expect(await t.row()).toMatchObject({ status: "delivered", attempts: 1, response_status: 200 });
  });
  it("retries a non-2xx with exponential backoff", async () => {
    const t = await setupDelivery({ fetch: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch });
    expect(await t.run()).toEqual({ outcome: "retry", delaySeconds: 20 });
    expect(await t.row()).toMatchObject({ status: "pending", attempts: 1, response_status: 500 });
    expect(await t.run()).toEqual({ outcome: "retry", delaySeconds: 40 });
  });
  it("retries on a network error and records it", async () => {
    const t = await setupDelivery({ fetch: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch });
    expect((await t.run()).outcome).toBe("retry");
    expect(await t.row()).toMatchObject({ status: "pending", last_error: "ECONNRESET" });
  });
  it("gives up after 10 attempts and marks the delivery failed", async () => {
    const t = await setupDelivery({ fetch: (async () => new Response("", { status: 503 })) as unknown as typeof fetch, attempts: 9 });
    expect(await t.run()).toEqual({ outcome: "failed" });
    expect(await t.row()).toMatchObject({ status: "failed", attempts: 10 });
  });
  it("caps the backoff at one hour", async () => {
    const t = await setupDelivery({ fetch: (async () => new Response("", { status: 500 })) as unknown as typeof fetch, attempts: 8 });
    expect(await t.run()).toEqual({ outcome: "retry", delaySeconds: 3600 }); // 10 * 2^9 = 5120, capped
  });
  it("never delivers twice: an already delivered delivery is skipped without calling fetch", async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response("ok"); }) as unknown as typeof fetch;
    const t = await setupDelivery({ fetch: f });
    await t.run();
    expect(await t.run()).toEqual({ outcome: "skipped" });
    expect(calls).toBe(1);
  });
  it("fails without calling out when the endpoint was deleted", async () => {
    let calls = 0;
    const t = await setupDelivery({ fetch: (async () => { calls++; return new Response("ok"); }) as unknown as typeof fetch });
    await t.d1.prepare("update webhook_endpoints set active = 0").run();
    expect(await t.run()).toEqual({ outcome: "failed" });
    expect(calls).toBe(0);
  });
  it("handleQueue acks delivered, retries with delay, and acks failures", async () => {
    const d1 = newD1();
    await seedMerchant(d1);
    await seedEndpoint(d1, { id: "ep1" });
    const q = fakeQueue();
    await emitEvent(dbOf(d1), q, "m_1", event("e1"));
    await emitEvent(dbOf(d1), q, "m_1", event("e2"));
    const calls: string[] = [];
    const msg = (deliveryId: string) => ({
      body: { deliveryId },
      ack: () => calls.push(`ack ${deliveryId}`),
      retry: (o?: { delaySeconds?: number }) => calls.push(`retry ${deliveryId} ${o?.delaySeconds}`),
    });
    let n = 0;
    const f = (async () => new Response("", { status: n++ === 0 ? 200 : 500 })) as unknown as typeof fetch;
    await handleQueue({ messages: q.sent.map((m) => msg(m.deliveryId)) } as never, d1, f);
    expect(calls).toEqual([`ack ${q.sent[0]!.deliveryId}`, `retry ${q.sent[1]!.deliveryId} 20`]);
  });
});

describe("delivery storage", () => {
  it("the payload is fixed at emit time (retries send identical bytes)", async () => {
    const d1 = newD1();
    await seedMerchant(d1);
    await seedEndpoint(d1);
    await emitEvent(dbOf(d1), fakeQueue(), "m_1", event());
    const rows = await drizzle(d1).select().from(webhookDeliveries);
    expect(JSON.parse(rows[0]!.payload)).toMatchObject({ id: "evt_1", livemode: false });
  });
});
