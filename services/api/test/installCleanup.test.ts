import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import type { ChainClient } from "../src/chain";
import { sha256Hex } from "../src/lib/crypto";
import { cleanupInstallInvoices } from "../../../apps/install-proof/src/cleanup";
import { requiredScope } from "../src/oauth/scopes";
import { seedMerchant, setup } from "./helpers/app";

const creationRequest = { amount: "1.00", successUrl: "https://install-proof-staging.stenmont.com/orders/proof-order", cancelUrl: "https://install-proof-staging.stenmont.com/orders/proof-order/pay", metadata: { order: "proof-order" } };
const id = `0x${"d1".repeat(32)}`;
async function fixture(status = "open", chain: Partial<ChainClient> = {}, environment = "staging") {
  const t = setup(chain, { ENVIRONMENT: environment });
  const key = await seedMerchant(t.db);
  await t.db.prepare("INSERT INTO invoices (id,merchant_id,number,status,amount,meta_hash,metadata,success_url,cancel_url,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, "m_1", "INSTALL-OLD", status, "1000000", `0x${"0".repeat(64)}`, '{"order":"proof-order"}', creationRequest.successUrl, creationRequest.cancelUrl, "2026-11-06T10:00:00Z", "2026-11-06T10:00:00Z").run();
  const clean = (body = {}) => t.req(`/v1/invoices/${id}/expire-install`, { method: "POST", key, body: JSON.stringify(body) });
  const state = () => t.db.prepare("SELECT status FROM invoices WHERE id=?").bind(id).first("status");
  return { ...t, key, clean, state };
}

describe("isolated install invoice cleanup", () => {
  it("cleans through the real store-to-API contract", async () => {
    const t = await fixture(); const data = new Map<string, string>();
    const orders = { get: async (key: string, type?: string) => { const value = data.get(key); return value ? type === "json" ? JSON.parse(value) : value : null; }, put: async (key: string, value: string) => { data.set(key, value); } } as unknown as KVNamespace;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      return t.req(url.pathname + url.search, { ...init, key: t.key });
    };
    const result = await cleanupInstallInvoices({ ORDERS: orders, SHOP_URL: "https://install-proof-staging.stenmont.com", STENMONT_API_KEY: t.key, STENMONT_WEBHOOK_SECRET: "unused-test-value" }, [id], fetcher);
    expect(result.changed).toMatchObject([{ id, status: "expired" }]);
    expect(await t.state()).toBe("expired");
    expect(data.get("retired:proof-order")).toBe("expired");
  });
  it("expires an old unpaid hosted invoice and keeps the audit record", async () => {
    const t = await fixture();
    const response = await t.clean();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id, status: "expired", changed: true });
    expect(await t.state()).toBe("expired");
    const audit = await t.db.prepare("SELECT action FROM audit_log WHERE merchant_id='m_1'").all();
    expect(audit.results.some((r) => r.action === "invoice.install_expired")).toBe(true);
    expect((await t.req(`/pay/${id}`)).status).toBe(404);
  });
  it("fails an abandoned creation and releases only its old unfinished key", async () => {
    const t = await fixture("creating");
    for (const [key, response, at] of [["old-creation", "", "2026-11-06T10:00:00Z"], ["completed", "{}", "2026-11-06T10:00:00Z"], ["recent", "", "2026-11-06T11:59:00Z"]]) {
      await t.db.prepare("INSERT INTO idempotency_keys (key,merchant_id,response,fingerprint,created_at) VALUES (?,'m_1',?,?,?)").bind(key, response, await sha256Hex(`POST /v1/invoices\n${JSON.stringify(creationRequest)}`), at).run();
    }
    const response = await t.clean({ creationKey: "old-creation", creationRequest });
    expect(await response.json()).toMatchObject({ status: "failed", creationReleased: true });
    expect(await t.state()).toBe("failed");
    const rows = await t.db.prepare("SELECT key FROM idempotency_keys ORDER BY key").all();
    expect(rows.results.map((r) => r.key)).toEqual(["completed", "recent"]);
    expect(await (await t.clean({ creationKey: "old-creation", creationRequest })).json()).toMatchObject({ changed: false });
  });
  it("never releases another unfinished operation's key", async () => {
    const t = await fixture("creating");
    await t.db.prepare("INSERT INTO idempotency_keys (key,merchant_id,response,fingerprint,created_at) VALUES ('unrelated','m_1','','different-request','2026-11-06T10:00:00Z')").run();
    const response = await t.clean({ creationKey: "unrelated", creationRequest });
    expect(response.status).toBe(409);
    expect(await t.state()).toBe("creating");
    expect(await t.db.prepare("SELECT key FROM idempotency_keys WHERE key='unrelated'").first("key")).toBe("unrelated");
  });
  it.each(["paid", "settled", "partially_paid", "cancelled"])("never changes a %s record", async (status) => {
    const t = await fixture(status);
    expect(await (await t.clean()).json()).toMatchObject({ changed: false });
    expect(await t.state()).toBe(status);
  });
  it("keeps recent invoices and creations", async () => {
    for (const status of ["open", "creating"]) {
      const t = await fixture(status);
      await t.db.prepare("UPDATE invoices SET created_at='2026-11-06T11:59:00Z'").run();
      expect(await (await t.clean()).json()).toMatchObject({ changed: false });
      expect(await t.state()).toBe(status);
    }
  });
  it("does not trust a stale database when payment is already onchain", async () => {
    const t = await fixture("open", { invoiceState: async () => ({ status: 2, paid: 1000000n, hook: zeroAddress }) });
    expect(await (await t.clean()).json()).toMatchObject({ changed: false });
    expect(await t.state()).toBe("open");
  });
  it("leaves financed invoices alone", async () => {
    const t = await fixture("open", { invoiceState: async () => ({ status: 1, paid: 0n, hook: "0x1111111111111111111111111111111111111111" }) });
    expect(await (await t.clean()).json()).toMatchObject({ changed: false });
    expect(await t.state()).toBe("open");
  });
  it("fails closed when chain state cannot be checked", async () => {
    const t = await fixture("open", { invoiceState: async () => { throw new Error("RPC unavailable"); } });
    expect((await t.clean()).status).toBe(503);
    expect(await t.state()).toBe("open");
  });
  it("refuses production and another business", async () => {
    const prod = await fixture("open", {}, "production");
    expect((await prod.clean()).status).toBe(404);
    const t = await fixture();
    const other = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
    expect((await t.req(`/v1/invoices/${id}/expire-install`, { method: "POST", key: other, body: "{}" })).status).toBe(404);
    expect(await t.state()).toBe("open");
  });
  it("lets a concurrently indexed payment win", async () => {
    const t = await fixture();
    t.chain.invoiceState = async () => {
      await t.db.prepare("UPDATE invoices SET status='paid', amount_paid='1000000'").run();
      return { status: 1, paid: 0n, hook: zeroAddress };
    };
    expect(await (await t.clean()).json()).toMatchObject({ changed: false });
    expect(await t.state()).toBe("paid");
  });
  it("keeps an invoice whose payment awaits indexing", async () => {
    const t = await fixture();
    await t.db.prepare("INSERT INTO relayer_txs (id,merchant_id,invoice_id,kind,status,idempotency_key,created_at,updated_at) VALUES ('tx','m_1',?,'pay','success','payment','2026-11-06T11:00:00Z','2026-11-06T11:00:00Z')").bind(id).run();
    expect(await (await t.clean()).json()).toMatchObject({ changed: false });
    expect(await t.state()).toBe("open");
  });
  it("does not give connected OAuth apps cleanup permission", () => {
    expect(requiredScope("POST", `/v1/invoices/${id}/expire-install`)).toBeNull();
  });
  it("does not expire an ordinary merchant invoice", async () => {
    const t = await fixture();
    await t.db.prepare("UPDATE invoices SET success_url='https://other.example/order'").run();
    expect((await t.clean()).status).toBe(400);
    expect(await t.state()).toBe("open");
  });
});
