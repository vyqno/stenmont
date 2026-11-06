import { describe, expect, it } from "vitest";
import { Stenmont, StenmontError } from "../src";

type Seen = { url: string; method: string; headers: Headers; body: unknown };
function mock(respond: (seen: Seen) => { status?: number; body?: unknown; text?: string }) {
  const seen: Seen[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const s = { url, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body as string) : undefined };
    seen.push(s);
    const r = respond(s);
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": r.text ? "text/csv" : "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { seen, client: new Stenmont({ apiKey: "sk_test_" + "a".repeat(32), baseUrl: "https://api.test/", fetch }) };
}

describe("Stenmont client", () => {
  it("creates an invoice: bearer key, JSON body, an idempotency key, trailing slash handled", async () => {
    const { seen, client } = mock(() => ({ status: 201, body: { id: "0xabc", payUrl: "https://app.test/pay/0xabc", status: "open" } }));
    const inv = await client.invoices.create({ amount: "12.50", customerEmail: "a@b.co", dueDate: "2026-12-01T00:00:00Z", metadata: { order: "42" } });
    expect(inv).toMatchObject({ id: "0xabc", payUrl: "https://app.test/pay/0xabc" });
    expect(seen[0]).toMatchObject({ url: "https://api.test/v1/invoices", method: "POST", body: { amount: "12.50", customerEmail: "a@b.co", dueDate: "2026-12-01T00:00:00Z", metadata: { order: "42" } } });
    expect(seen[0]!.headers.get("authorization")).toBe("Bearer sk_test_" + "a".repeat(32));
    expect(seen[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("uses the caller's idempotency key so a retry cannot create a second invoice", async () => {
    const { seen, client } = mock(() => ({ status: 201, body: { id: "0x1" } }));
    await client.invoices.create({ amount: "1" }, { idempotencyKey: "order-42" });
    expect(seen[0]!.headers.get("idempotency-key")).toBe("order-42");
  });
  it("checkout sessions are invoices with return links; the customer is sent to the pay page", async () => {
    const { seen, client } = mock(() => ({ status: 201, body: { id: "0xabc", payUrl: "https://app.test/pay/0xabc" } }));
    const s = await client.checkout.sessions.create({ amount: "5", successUrl: "https://shop.example/ok", cancelUrl: "https://shop.example/cart", metadata: { order: "7" } });
    expect(s).toEqual({ id: "0xabc", url: "https://app.test/pay/0xabc" });
    expect(seen[0]!.body).toEqual({ amount: "5", successUrl: "https://shop.example/ok", cancelUrl: "https://shop.example/cart", metadata: { order: "7" } });
  });
  it("turns API errors into StenmontError with the code and status", async () => {
    const { client } = mock(() => ({ status: 409, body: { error: { code: "invoice_number_taken", message: "Invoice number X is already used" } } }));
    const err = await client.invoices.create({ amount: "1", number: "X" }).catch((e) => e);
    expect(err).toBeInstanceOf(StenmontError);
    expect(err).toMatchObject({ status: 409, code: "invoice_number_taken", message: "Invoice number X is already used" });
  });
  it("survives a non-JSON failure (gateway error) without throwing a parse error", async () => {
    const { client } = mock(() => ({ status: 502, text: "<html>bad gateway</html>" }));
    expect(await client.invoices.get("0x1").catch((e) => e)).toMatchObject({ status: 502, code: "http_502" });
  });
  it("gets and lists invoices with query parameters", async () => {
    const { seen, client } = mock(() => ({ body: { data: [] } }));
    await client.invoices.list({ limit: 5, status: "paid" });
    await client.invoices.get("0xabc");
    expect(seen[0]!.url).toBe("https://api.test/v1/invoices?limit=5&status=paid");
    expect(seen[1]!.url).toBe("https://api.test/v1/invoices/0xabc");
  });
  it("refunds, subscriptions and the accountant export map to their endpoints", async () => {
    const { seen, client } = mock((s) => (s.url.endsWith(".csv") || s.url.includes(".csv?") ? { text: "date,type\r\n" } : { status: 201, body: { id: "x" } }));
    await client.refunds.create({ invoiceId: "0xabc", amount: "2.50" });
    await client.subscriptions.create({ amount: "9.99", periodSeconds: 2_592_000, maxCharges: 12 });
    await client.subscriptions.cancel("0xdef");
    expect(await client.exports.paymentsCsv({ from: "2026-11-01", format: "quickbooks" })).toBe("date,type\r\n");
    expect(seen.map((s) => `${s.method} ${s.url.replace("https://api.test", "")}`)).toEqual([
      "POST /v1/refunds",
      "POST /v1/subscriptions",
      "POST /v1/subscriptions/0xdef/cancel",
      "GET /v1/exports/payments.csv?from=2026-11-01&format=quickbooks",
    ]);
  });
  it("refuses to be built without an API key", () => {
    expect(() => new Stenmont({ apiKey: "" })).toThrow(/apiKey/);
  });
});
