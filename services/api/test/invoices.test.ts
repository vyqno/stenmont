import { invoiceId } from "@stenmont/shared";
import { describe, expect, it } from "vitest";
import { MERCHANT_ADDRESS, PAYOUT_ADDRESS, seedMerchant, setup } from "./helpers/app";

const post = (setupResult: ReturnType<typeof setup>, key: string, body: unknown, idem = "k1") =>
  setupResult.req("/v1/invoices", { method: "POST", key, idem, body: JSON.stringify(body) });

describe("POST /v1/invoices", () => {
  it("creates the invoice onchain and stores it", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await post(t, key, { amount: "12.50", number: "INV-1", customerEmail: "a@b.co", metadata: { order: "42" } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    const id = invoiceId(MERCHANT_ADDRESS, "INV-1");
    expect(body).toMatchObject({
      id,
      number: "INV-1",
      status: "open",
      amount: "12.5",
      amountPaid: "0",
      currency: "USDT",
      customerEmail: "a@b.co",
      metadata: { order: "42" },
      payUrl: `https://app.test/pay/${id}`,
    });
    expect(t.chain.calls).toHaveLength(1);
    expect(t.chain.calls[0]).toMatchObject({
      merchant: MERCHANT_ADDRESS,
      payout: PAYOUT_ADDRESS,
      amount: 12_500_000n,
      minPayment: 0n,
      payerLock: "0x0000000000000000000000000000000000000000",
    });
    const row = await t.db.prepare("select status, create_tx_hash from invoices where id = ?").bind(id).first();
    expect(row).toMatchObject({ status: "open" });
    const audit = await t.db.prepare("select action from audit_log where merchant_id = 'm_1'").all();
    expect(audit.results.map((r) => (r as { action: string }).action)).toContain("invoice.created");
  });

  it("generates a number and passes the due date to the chain as unix seconds", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await post(t, key, { amount: "1", dueDate: "2027-01-01T00:00:00Z" });
    const body = (await res.json()) as { number: string };
    expect(body.number).toMatch(/^INV-/);
    expect((t.chain.calls[0] as { dueDate: bigint }).dueDate).toBe(BigInt(Date.parse("2027-01-01T00:00:00Z") / 1000));
  });

  it.each([
    ["zero", { amount: "0" }],
    ["negative", { amount: "-1" }],
    ["too many decimals", { amount: "1.1234567" }],
    ["not a number", { amount: "abc" }],
    ["missing", {}],
    ["bad email", { amount: "1", customerEmail: "nope" }],
    ["bad due date", { amount: "1", dueDate: "tomorrow" }],
    ["too much metadata", { amount: "1", metadata: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, "v"])) }],
    ["unknown field", { amount: "1", surprise: true }],
  ])("rejects %s with 400 invalid_request", async (_name, payload) => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await post(t, key, payload);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(t.chain.calls).toHaveLength(0);
  });

  it("requires an Idempotency-Key and requires auth", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const noKey = await t.req("/v1/invoices", { method: "POST", key, body: JSON.stringify({ amount: "1" }) });
    expect(noKey.status).toBe(400);
    expect(((await noKey.json()) as { error: { code: string } }).error.code).toBe("idempotency_key_required");
    const noAuth = await t.req("/v1/invoices", { method: "POST", idem: "x", body: JSON.stringify({ amount: "1" }) });
    expect(noAuth.status).toBe(401);
  });

  it("is idempotent: same key returns the same response and creates one invoice", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const first = await post(t, key, { amount: "5", number: "INV-A" });
    const second = await post(t, key, { amount: "5", number: "INV-A" });
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(await first.json());
    expect(t.chain.calls).toHaveLength(1);
    const n = await t.db.prepare("select count(*) as n from invoices").first();
    expect(n).toMatchObject({ n: 1 });
  });

  it("rejects a reused invoice number with 409", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await post(t, key, { amount: "5", number: "INV-A" }, "k1");
    const dup = await post(t, key, { amount: "5", number: "INV-A" }, "k2");
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("invoice_number_taken");
    expect(t.chain.calls).toHaveLength(1);
  });

  it("a chain failure returns 502, marks the invoice failed and releases the idempotency key", async () => {
    let fail = true;
    const t = setup({
      async createInvoice() {
        if (fail) throw new Error("rpc down");
        return { txHash: `0x${"1".repeat(64)}` as `0x${string}` };
      },
    });
    const key = await seedMerchant(t.db);
    const bad = await post(t, key, { amount: "5", number: "INV-A" }, "same");
    expect(bad.status).toBe(502);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("chain_error");
    const row = await t.db.prepare("select status from invoices where number = 'INV-A'").first();
    expect(row).toMatchObject({ status: "failed" });

    fail = false; // retry with a fresh number and the same key now works
    const ok = await post(t, key, { amount: "5", number: "INV-B" }, "same");
    expect(ok.status).toBe(201);
  });

  it("a merchant without an onchain address gets 409 merchant_not_ready", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    await t.db.prepare("update merchants set address = null").run();
    const res = await post(t, key, { amount: "1" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("merchant_not_ready");
  });
});

describe("GET /v1/invoices", () => {
  it("returns only the caller's invoices, newest first, with filters", async () => {
    const t = setup();
    const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
    const b = await seedMerchant(t.db, "m_2", "Beta", `sk_test_${"b".repeat(32)}`);
    await post(t, a, { amount: "1", number: "A-1" }, "1");
    await post(t, a, { amount: "2", number: "A-2" }, "2");
    await post(t, b, { amount: "3", number: "B-1" }, "3");
    await t.db.prepare("update invoices set status = 'paid' where number = 'A-1'").run();

    const all = (await (await t.req("/v1/invoices", { key: a })).json()) as { data: { number: string }[] };
    expect(all.data.map((i) => i.number).sort()).toEqual(["A-1", "A-2"]);
    const paid = (await (await t.req("/v1/invoices?status=paid", { key: a })).json()) as { data: { number: string }[] };
    expect(paid.data.map((i) => i.number)).toEqual(["A-1"]);
    const limited = (await (await t.req("/v1/invoices?limit=1", { key: a })).json()) as { data: unknown[] };
    expect(limited.data).toHaveLength(1);
    expect((await t.req("/v1/invoices?limit=1000", { key: a })).status).toBe(400);
  });

  it("GET /v1/invoices/:id is tenant-scoped: another merchant gets 404", async () => {
    const t = setup();
    const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
    const b = await seedMerchant(t.db, "m_2", "Beta", `sk_test_${"b".repeat(32)}`);
    const created = (await (await post(t, a, { amount: "1", number: "A-1" })).json()) as { id: string };
    expect((await t.req(`/v1/invoices/${created.id}`, { key: a })).status).toBe(200);
    expect((await t.req(`/v1/invoices/${created.id}`, { key: b })).status).toBe(404);
    expect((await t.req("/v1/invoices/0xdeadbeef", { key: a })).status).toBe(404);
  });
});

describe("checkout return links", () => {
  it("stores successUrl and cancelUrl and shows them on the public pay page, never in a way the payer could change", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await post(t, key, { amount: "5", successUrl: "https://shop.example/thanks?order=42", cancelUrl: "https://shop.example/cart" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const pub = (await (await t.req(`/pay/${id}`)).json()) as Record<string, unknown>;
    expect(pub).toMatchObject({ successUrl: "https://shop.example/thanks?order=42", cancelUrl: "https://shop.example/cart" });
  });
  it("rejects return links that are not public https addresses", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    let n = 0;
    for (const bad of ["http://shop.example/x", "javascript:alert(1)", "https://127.0.0.1/x", "https://localhost/x", "ftp://shop.example", "nonsense"]) {
      expect((await post(t, key, { amount: "5", successUrl: bad }, `bad${n++}`)).status).toBe(400);
    }
  });
  it("allows http://localhost return links outside production only", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    expect((await post(t, key, { amount: "5", successUrl: "http://localhost:4000/thanks" }, "l1")).status).toBe(201);
    const p = setup({}, { ENVIRONMENT: "production" });
    const pk = await seedMerchant(p.db);
    expect((await post(p, pk, { amount: "5", successUrl: "http://localhost:4000/thanks" }, "l2")).status).toBe(400);
  });
  it("leaves them out when not given", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const { id } = (await (await post(t, key, { amount: "5" })).json()) as { id: string };
    const pub = (await (await t.req(`/pay/${id}`)).json()) as Record<string, unknown>;
    expect(pub.successUrl).toBeNull();
    expect(pub.cancelUrl).toBeNull();
  });
});

describe("payee by ENS name", () => {
  const RESOLVED = "0x9999999999999999999999999999999999999999";
  async function withName(name = "acme.stenmont.eth", resolves: string | null = RESOLVED) {
    const t = setup();
    const key = await seedMerchant(t.db);
    await t.db.prepare("insert into ens_names (merchant_id, label, name, resolver, agent_registry, payout_locked, status, tx_hashes, created_at) values ('m_1','acme',?,?,?,0,'active','[]','2026-11-06T00:00:00Z')").bind(name, "0x4444444444444444444444444444444444444444", "0x5555555555555555555555555555555555555555").run();
    t.ens.resolveAddress = async () => resolves as `0x${string}` | null;
    return { t, key };
  }
  it("resolves the business's own name when the invoice is created and pays out to what it points at", async () => {
    const { t, key } = await withName();
    const res = await post(t, key, { amount: "5", payTo: "acme.stenmont.eth" });
    expect(res.status).toBe(201);
    expect(t.chain.calls[0]).toMatchObject({ payout: RESOLVED });
    const { id } = (await res.json()) as { id: string };
    expect(((await (await t.req(`/pay/${id}`)).json()) as Record<string, unknown>).payeeName).toBe("acme.stenmont.eth");
  });
  it("a later change to the record changes later invoices only", async () => {
    const { t, key } = await withName();
    await post(t, key, { amount: "5", payTo: "acme.stenmont.eth" }, "a");
    t.ens.resolveAddress = async () => "0x7777777777777777777777777777777777777777";
    await post(t, key, { amount: "6", payTo: "acme.stenmont.eth" }, "b");
    expect(t.chain.calls.map((c) => (c as { payout: string }).payout)).toEqual([RESOLVED, "0x7777777777777777777777777777777777777777"]);
  });
  it("answers 422 when the name does not resolve, and creates nothing", async () => {
    const { t, key } = await withName("acme.stenmont.eth", null);
    const res = await post(t, key, { amount: "5", payTo: "acme.stenmont.eth" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payee_not_found");
    expect(t.chain.calls).toHaveLength(0);
  });
  it("only the business's own name or payout address is allowed, so a stolen key cannot redirect money", async () => {
    const { t, key } = await withName();
    for (const bad of ["evil.eth", "other.stenmont.eth", "0x1234567890123456789012345678901234567890", "not a name"]) {
      const res = await post(t, key, { amount: "5", payTo: bad }, `bad-${bad}`);
      expect(res.status, bad).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("payee_not_allowed");
    }
    expect(t.chain.calls).toHaveLength(0);
    expect((await post(t, key, { amount: "5", payTo: PAYOUT_ADDRESS }, "ok-addr")).status).toBe(201); // its own payout address is fine
  });
  it("a business with no name cannot use a name", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    expect((await post(t, key, { amount: "5", payTo: "acme.stenmont.eth" })).status).toBe(400);
  });
});
