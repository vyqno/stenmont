import { describe, expect, it } from "vitest";
import { signAccountToken } from "../src/account/token";
import { seedMerchant, setup } from "./helpers/app";
import { seedInvoice } from "./helpers/fixtures";

const SECRET = "s".repeat(32);
const ALICE = "0xA11CE00000000000000000000000000000000001"; // stored mixed-case on purpose
const BOB = "0xB0B0000000000000000000000000000000000002";
const NOW = new Date("2026-11-06T12:00:00Z");

async function world(env: Record<string, unknown> = { ACCOUNT_LINK_SECRET: SECRET }) {
  const t = setup({}, env);
  await seedMerchant(t.db, "m_1", "Acme");
  const inv1 = await seedInvoice(t.db, "INV-1", 12_500_000n);
  const inv2 = await seedInvoice(t.db, "INV-2", 4_000_000n);
  const at = NOW.toISOString();
  const pay = (id: string, invoice: string, payer: string, value: string, tx: string) =>
    t.db.prepare("insert into payments (id, invoice_id, payer, value, tx_hash, log_index, block_number, created_at) values (?,?,?,?,?,0,1,?)").bind(id, invoice, payer, value, tx, at).run();
  await pay("p1", inv1, ALICE, "12500000", `0x${"a1".repeat(32)}`);
  await pay("p2", inv2, BOB, "4000000", `0x${"b2".repeat(32)}`);
  const refund = (id: string, invoice: string, to: string, value: string, tx: string) =>
    t.db.prepare("insert into refunds (id, invoice_id, to_address, value, tx_hash, log_index, block_number, created_at) values (?,?,?,?,?,0,1,?)").bind(id, invoice, to, value, tx, at).run();
  await refund("r1", inv1, ALICE.toLowerCase(), "2500000", `0x${"c3".repeat(32)}`);
  await refund("r2", inv2, BOB, "1000000", `0x${"d4".repeat(32)}`);
  const sub = (id: string, payer: string, status: string) =>
    t.db.prepare("insert into subscriptions (id, merchant_id, amount, period_seconds, max_charges, start_at, payer, status, charges, next_charge_at, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, "m_1", "3000000", 2_592_000, 12, 1, payer, status, 2, 1_800_000_000, at, at).run();
  await sub(`0x${"01".repeat(32)}`, ALICE, "active");
  await sub(`0x${"02".repeat(32)}`, BOB, "active");
  const get = (token: string | null, path = "/account/summary", headers: Record<string, string> = {}) =>
    t.req(path, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  const link = (payer: string, purpose = "receipts", when = NOW) => signAccountToken(SECRET, payer, purpose, when);
  return { t, get, link };
}

describe("GET /account/summary", () => {
  it("shows the payer their own payments, refunds and subscriptions, with receipt links", async () => {
    const { get, link } = await world();
    const res = await get(await link(ALICE));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as any;
    expect(body.payments).toEqual([
      { invoiceNumber: "INV-1", merchantName: "Acme", amount: "12.5", at: NOW.toISOString(), receiptUrl: `https://explorer.testnet.whitechain.io/tx/0x${"a1".repeat(32)}` },
    ]);
    expect(body.refunds).toEqual([
      { invoiceNumber: "INV-1", merchantName: "Acme", amount: "2.5", at: NOW.toISOString(), receiptUrl: `https://explorer.testnet.whitechain.io/tx/0x${"c3".repeat(32)}` },
    ]);
    expect(body.subscriptions).toEqual([
      { id: `0x${"01".repeat(32)}`, merchantName: "Acme", amount: "3", periodSeconds: 2_592_000, maxCharges: 12, charges: 2, status: "active", nextChargeAt: new Date(1_800_000_000 * 1000).toISOString(), manager: "0x3e1C51d461e6adb0b087DC39d41942E084eba2DD" },
    ]);
  });

  it("never shows another payer's data, nor internal ids", async () => {
    const { get, link } = await world();
    const alice = JSON.stringify(await (await get(await link(ALICE))).json());
    for (const other of ["b2".repeat(32), "d4".repeat(32), "02".repeat(32), "INV-2", "m_1", "merchantId", "customerEmail"]) expect(alice).not.toContain(other);
    const bob = (await (await get(await link(BOB))).json()) as any;
    expect(bob.payments.map((p: any) => p.invoiceNumber)).toEqual(["INV-2"]);
    expect(JSON.stringify(bob)).not.toContain("a1".repeat(32));
    const nobody = (await (await get(await link("0xC0FFEE0000000000000000000000000000000003"))).json()) as any;
    expect(nobody).toEqual({ payments: [], refunds: [], subscriptions: [] });
  });

  it("refuses a missing, forged, expired, other-purpose or other-secret link, and says the same thing for each", async () => {
    const { get, link } = await world();
    const good = await link(ALICE);
    const [v, , p, e, m] = good.split(".");
    const forged = [
      null,
      "garbage",
      [v, BOB.slice(2).toLowerCase(), p, e, m].join("."), // alice's signature on bob's address
      await link(ALICE, "receipts", new Date("2026-10-01T00:00:00Z")),
      await link(ALICE, "something-else"),
      await signAccountToken("z".repeat(32), ALICE, "receipts", NOW),
    ];
    for (const token of forged) {
      const res = await get(token);
      expect(res.status, String(token)).toBe(401);
      expect(((await res.json()) as any).error.code).toBe("invalid_link");
    }
    // a token in the address bar is not accepted: it would end up in logs
    expect((await get(null, `/account/summary?token=${good}`)).status).toBe(401);
  });

  it("is off, not open, when the secret is not configured", async () => {
    const { t } = await world({});
    const res = await t.req("/account/summary", { headers: { authorization: "Bearer anything" } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.code).toBe("account_unavailable");
  });

  it("answers the browser preflight for our own app only", async () => {
    const { t } = await world();
    const ask = (origin: string) => t.req("/account/summary", { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization" } });
    const own = await ask("https://app.test");
    expect(own.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(own.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    expect((await ask("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("the link a payer is given after paying", () => {
  const PAYER = "0x3333333333333333333333333333333333333333";
  const pay = (t: ReturnType<typeof setup>, id: string) =>
    t.req("/relay/pay", { method: "POST", headers: { "cf-connecting-ip": "1.1.1.1" }, body: JSON.stringify({ invoiceId: id, value: "5", payer: PAYER, validAfter: "0", validBefore: "9999999999", salt: `0x${"01".padStart(64, "0")}`, signature: `0x${"22".repeat(65)}` }) });

  it("comes back with a successful payment and opens exactly that payer's page", async () => {
    const t = setup({}, { ACCOUNT_LINK_SECRET: SECRET });
    await seedMerchant(t.db);
    const id = await seedInvoice(t.db, "INV-9", 100_000_000n);
    await t.db.prepare("insert into gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt, version) values ('m_1', ?, ?, '0', '2026-11-06', ?, 0)").bind((10n ** 17n).toString(), (5n * 10n ** 16n).toString(), (1000n * 10n ** 6n).toString()).run();
    const res = await pay(t, id);
    expect(res.status).toBe(200);
    const { accountToken } = (await res.json()) as { accountToken: string };
    const summary = await t.req("/account/summary", { headers: { authorization: `Bearer ${accountToken}` } });
    expect(summary.status).toBe(200);
  });

  it("is simply absent when links are not configured", async () => {
    const t = setup();
    await seedMerchant(t.db);
    const id = await seedInvoice(t.db, "INV-9", 100_000_000n);
    await t.db.prepare("insert into gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt, version) values ('m_1', ?, ?, '0', '2026-11-06', ?, 0)").bind((10n ** 17n).toString(), (5n * 10n ** 16n).toString(), (1000n * 10n ** 6n).toString()).run();
    const body = (await (await pay(t, id)).json()) as Record<string, unknown>;
    expect(body.status).toBe("success");
    expect(body).not.toHaveProperty("accountToken");
  });
});
