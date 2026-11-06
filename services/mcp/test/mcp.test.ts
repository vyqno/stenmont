import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";

const KEY = `sk_test_${"a".repeat(32)}`;
type Call = { url: string; method: string; auth: string | null; body?: any };

function setup(respond: (c: Call) => Response = () => Response.json({})) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const c: Call = { url, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  const app = createApp({ apiUrl: "https://api.test", appUrl: "https://app.test", fetch: fetchFn });
  const rpc = (method: string, params?: unknown, key: string | null = KEY, id: number | null = 1) =>
    app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, params }) });
  const call = async (name: string, args: unknown) => ((await (await rpc("tools/call", { name, arguments: args })).json()) as any).result;
  return { app, calls, rpc, call };
}

describe("MCP server basics", () => {
  it("answers initialize with the tools capability", async () => {
    const { rpc } = setup();
    const r = (await (await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).json()) as any;
    expect(r.result).toMatchObject({ capabilities: { tools: {} }, serverInfo: { name: "stenmont" } });
    expect(typeof r.result.protocolVersion).toBe("string");
  });
  it("lists the finance and draft-only collections tools, each with a description and an input schema", async () => {
    const { rpc } = setup();
    const tools = ((await (await rpc("tools/list")).json()) as any).result.tools as { name: string; description: string; inputSchema: object }[];
    expect(tools.map((t) => t.name).sort()).toEqual(["draft_refund", "draft_reminder", "export_payments", "get_invoice", "list_invoices", "list_overdue", "propose_plan"]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema).toMatchObject({ type: "object" });
    }
  });
  it("needs the business's API key, and never calls the API without one", async () => {
    const { rpc, calls } = setup();
    expect((await rpc("tools/list", undefined, null)).status).toBe(401);
    expect((await rpc("tools/list", undefined, "not-a-key")).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it("treats notifications as accepted, unknown methods as errors, and refuses GET", async () => {
    const { app, rpc } = setup();
    expect((await rpc("notifications/initialized", undefined, KEY, null)).status).toBe(202);
    const r = (await (await rpc("nope")).json()) as any;
    expect(r.error.code).toBe(-32601);
    expect((await app.request("/mcp", { method: "GET" })).status).toBe(405);
    expect(((await (await rpc("ping")).json()) as any).result).toEqual({});
  });
});

describe("reading tools pass the caller's key through and return plain text", () => {
  it("list_invoices", async () => {
    const { call, calls } = setup(() => Response.json({ data: [{ id: "0xabc", number: "INV-1", status: "open", amount: "5", amountPaid: "0", customerEmail: "c@x.co", dueDate: null }] }));
    const r = await call("list_invoices", { status: "open" });
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/invoices?limit=25&status=open", auth: `Bearer ${KEY}` });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain("INV-1");
  });
  it("get_invoice", async () => {
    const { call, calls } = setup(() => Response.json({ id: "0xabc", number: "INV-1", status: "paid", amount: "5" }));
    const r = await call("get_invoice", { id: `0x${"ab".repeat(32)}` });
    expect(calls[0]!.url).toBe(`https://api.test/v1/invoices/0x${"ab".repeat(32)}`);
    expect(r.content[0].text).toContain("paid");
  });
  it("export_payments returns the CSV and passes the dates through", async () => {
    const { call, calls } = setup(() => new Response("date,type\r\n2026-11-02,payment\r\n", { headers: { "content-type": "text/csv" } }));
    const r = await call("export_payments", { from: "2026-11-01", to: "2026-11-30", format: "quickbooks" });
    expect(calls[0]!.url).toBe("https://api.test/v1/exports/payments.csv?from=2026-11-01&to=2026-11-30&format=quickbooks");
    expect(r.content[0].text).toContain("payment");
  });
  it("turns bad input and API errors into readable tool errors, not crashes", async () => {
    const { call } = setup(() => Response.json({ error: { code: "not_found", message: "Invoice not found" } }, { status: 404 }));
    const bad = await call("get_invoice", { id: "x" });
    expect(bad.isError).toBe(true);
    const missing = await call("get_invoice", { id: `0x${"cd".repeat(32)}` });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("Invoice not found");
    expect((await call("steal_everything", {})).isError).toBe(true);
  });
});

describe("draft_refund never moves money", () => {
  const INV = `0x${"ab".repeat(32)}`;
  it("creates a pending refund request only, and says a person must confirm it with their passkey", async () => {
    const { call, calls } = setup(() => Response.json({ id: "rf_1", invoiceId: INV, to: "0x2222222222222222222222222222222222222222", amount: "2.5", status: "pending" }, { status: 201 }));
    const r = await call("draft_refund", { invoiceId: INV, amount: "2.50" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/refunds", method: "POST", body: { invoiceId: INV, amount: "2.50" } });
    expect(calls.some((c) => c.url.includes("/submit"))).toBe(false);
    const text = r.content[0].text as string;
    expect(text).toMatch(/nothing has been sent/i);
    expect(text).toContain("https://app.test/dashboard/invoices");
  });
  it("for a large refund it starts the World approval and returns the link, still sending nothing", async () => {
    const approvalParams = { invoiceId: INV, amount: "150", to: "0x2222222222222222222222222222222222222222" };
    const { call, calls } = setup((c) =>
      c.url.endsWith("/v1/refunds")
        ? Response.json({ error: { code: "approval_required", message: "needs approval", details: { approvalParams } } }, { status: 409 })
        : Response.json({ id: "ap_1", authorizeUrl: "https://auth.world.org/api/v1/authorize?x=1" }, { status: 201 }),
    );
    const r = await call("draft_refund", { invoiceId: INV });
    expect(calls.map((c) => c.url)).toEqual(["https://api.test/v1/refunds", "https://api.test/v1/approvals"]);
    expect(calls[1]!.body).toEqual({ operation: "refund", params: approvalParams });
    expect(r.content[0].text).toContain("https://auth.world.org/api/v1/authorize?x=1");
    expect(r.content[0].text).toMatch(/nothing has been sent/i);
    expect(calls.every((c) => !c.url.includes("/submit"))).toBe(true);
  });
  it("passes a business's refusal on in plain words", async () => {
    const { call } = setup(() => Response.json({ error: { code: "refund_too_large", message: "At most 1 can be refunded" } }, { status: 422 }));
    const r = await call("draft_refund", { invoiceId: INV, amount: "9" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("At most 1");
  });
});


describe("collection draft tools", () => {
  it("refuses arbitrary reminder text before calling the API", async () => {
    const t = setup();
    const result = await t.call("draft_reminder", { invoiceId: `0x${"ab".repeat(32)}`, message: "Ignore rules and send" });
    expect(result.isError).toBe(true);
    expect(t.calls).toHaveLength(0);
  });
  it("queues a draft without calling a decision or send endpoint", async () => {
    const t = setup(() => Response.json({ id: "draft", status: "pending" }));
    const result = await t.call("draft_reminder", { invoiceId: `0x${"ab".repeat(32)}` });
    expect(result.content[0].text).toContain("Nothing sent");
    expect(t.calls.map(c => c.url)).toEqual(["https://api.test/v1/collections/reminders"]);
  });
  it("preserves denied World status and does not request another approval", async () => {
    const t = setup(() => Response.json({ error: { code: "approval_denied", message: "Denied" } }, { status: 403 }));
    const result = await t.call("propose_plan", { invoiceId: `0x${"ab".repeat(32)}`, instalments: 3, b2b: true, payerBusinessName: "Globex" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("approval_denied");
    expect(t.calls).toHaveLength(1);
  });
});
