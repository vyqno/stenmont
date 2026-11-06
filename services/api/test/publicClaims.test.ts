import { describe, expect, it } from "vitest";
import { claims, invoices, merchants, payments } from "../src/db/schema";
import { confirmStatus, shortAddress } from "../src/routes/publicClaims";
import { seedMerchant, setup } from "./helpers/app";
import { dbOf } from "./helpers/fixtures";

const INV = `0x${"ab".repeat(32)}`;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const HOLDER = "0x4444444444444444444444444444444444444444";
const BUYER = "0x7777777777777777777777777777777777777777";
const CLAIM = "0x2EB9aaF14A2d729BC3F185A144571fCd23454914";
const NOW_S = Math.floor(new Date("2026-11-06T12:00:00Z").getTime() / 1000);
const STAMP = "2026-11-06T10:00:00.000Z";
const json = async (r: Response) => (await r.json()) as Record<string, any>;

async function seed(over: Partial<typeof claims.$inferInsert> = {}, opts: { show?: boolean; invoiceId?: string; merchantId?: string } = {}) {
  const t = setup();
  const key = await seedMerchant(t.db, "m_1", "Acme");
  const db = dbOf(t.db);
  const merchantId = opts.merchantId ?? "m_1";
  const invoiceId = opts.invoiceId ?? INV;
  await db.insert(invoices).values({
    id: invoiceId, merchantId, number: "ACME-SECRET-7", status: "open", amount: "100000000", metaHash: H(0), customerEmail: "secret@customer.example",
    metadata: JSON.stringify({ customerName: "Jane Private" }), dueDate: new Date((NOW_S + 30 * 86_400) * 1000).toISOString(), createdAt: STAMP, updatedAt: STAMP,
  });
  await db.insert(claims).values({
    id: "cl_1", invoiceId, merchantId, status: "funded", discountBps: 500, reserveBps: 1000, face: "100000000", price: "95000000", reserve: "10000000",
    dueDate: NOW_S + 30 * 86_400, deadline: NOW_S + 7 * 86_400, termsChallenge: "TERMS-CHALLENGE", hookChallenge: "HOOK-CHALLENGE", expiresAt: NOW_S + 3600,
    investor: HOLDER, listTxHash: H(1), fundTxHash: H(2), closeTxHash: null, showInvoiceNumber: opts.show ? 1 : 0,
    listedAt: "2026-11-06T10:01:00.000Z", fundedAt: "2026-11-06T10:05:00.000Z", createdAt: STAMP, updatedAt: STAMP, ...over,
  });
  t.chain.claimStates.set(invoiceId, { status: "funded", received: 0n, toHolder: 0n, fundBy: 0n });
  return { t, key, db, invoiceId };
}

describe("confirmStatus (database against chain)", () => {
  it("agrees when they match, or when the database is mid-purchase", () => {
    expect(confirmStatus("listed", "listed")).toBe(true);
    expect(confirmStatus("funded", "funded")).toBe(true);
    expect(confirmStatus("settled", "settled")).toBe(true);
    expect(confirmStatus("defaulted", "defaulted")).toBe(true);
    expect(confirmStatus("cancelled", "cancelled")).toBe(true);
    expect(confirmStatus("funding", "listed")).toBe(true);
    expect(confirmStatus("funding", "funded")).toBe(true);
  });
  it("disagrees otherwise", () => {
    expect(confirmStatus("funded", "settled")).toBe(false);
    expect(confirmStatus("listed", "funded")).toBe(false);
    expect(confirmStatus("settled", "none")).toBe(false);
    expect(confirmStatus("funded", "defaulted")).toBe(false);
  });
});

describe("shortAddress", () => {
  it("keeps the first six and last four characters", () => {
    expect(shortAddress(HOLDER)).toBe("0x4444…4444");
    expect(shortAddress("0x50c94c3021962047F10c9c58D80C4A7b73182a63")).toBe("0x50c9…2a63");
    expect(shortAddress(null)).toBeNull();
  });
});

describe("GET /public/claims/:id", () => {
  it("shows the certificate with the on-chain facts, confirmed by the chain, without logging in", async () => {
    const { t } = await seed();
    const res = await t.req(`/public/claims/${INV}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      invoiceId: INV, tokenId: BigInt(INV).toString(), contract: CLAIM, chainId: 1874, status: "funded",
      confirmation: { state: "confirmed", onchainStatus: "funded" },
      face: "100", price: "95", discount: "5", discountBps: 500, holder: "0x4444…4444",
      invoiceNumber: null, payerRecord: null,
    });
    expect(body.dueDate).toBe(new Date((NOW_S + 30 * 86_400) * 1000).toISOString());
    expect(body.transactions.list.url).toBe(`https://explorer.testnet.whitechain.io/tx/${H(1)}`);
    expect(body.transactions.fund.url).toBe(`https://explorer.testnet.whitechain.io/tx/${H(2)}`);
    expect(body.transactions.close).toBeNull();
    expect(body.times).toMatchObject({ listedAt: "2026-11-06T10:01:00.000Z", fundedAt: "2026-11-06T10:05:00.000Z", closedAt: null });
  });

  it("never carries private fields: emails, customer names, metadata, internal ids, challenges, the full holder address", async () => {
    const { t } = await seed();
    const text = await (await t.req(`/public/claims/${INV}`)).text();
    for (const secret of ["secret@customer.example", "Jane Private", "ACME-SECRET-7", "m_1", "cl_1", "CHALLENGE", "metaHash", "customerEmail", "metadata", HOLDER, "Acme"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("shows the invoice number only when the business chose to make it public", async () => {
    const hidden = await seed();
    expect((await json(await hidden.t.req(`/public/claims/${INV}`))).invoiceNumber).toBeNull();
    const shown = await seed({}, { show: true });
    expect((await json(await shown.t.req(`/public/claims/${INV}`))).invoiceNumber).toBe("ACME-SECRET-7");
  });

  it("404 for an unknown id, a malformed id, and a request nobody signed or sent", async () => {
    const { t } = await seed();
    expect((await t.req(`/public/claims/0x${"cd".repeat(32)}`)).status).toBe(404);
    expect((await t.req("/public/claims/nope")).status).toBe(404);
    expect((await t.req("/public/claims/cl_1")).status).toBe(404);
    for (const status of ["pending", "sending"]) {
      const p = await seed({ status });
      expect((await p.t.req(`/public/claims/${INV}`)).status).toBe(404);
    }
  });

  it("says unconfirmed when the database and the chain disagree, and shows both", async () => {
    const { t } = await seed();
    t.chain.claimStates.set(INV, { status: "settled", received: 1n, toHolder: 1n, fundBy: 0n });
    const body = await json(await t.req(`/public/claims/${INV}`));
    expect(body.status).toBe("unconfirmed");
    expect(body.confirmation).toMatchObject({ state: "unconfirmed", databaseStatus: "funded", onchainStatus: "settled" });
  });

  it("says unconfirmed when the chain cannot be read, without failing the page", async () => {
    const { t } = await seed();
    t.chain.claimState = async () => { throw new Error("rpc down"); };
    const res = await t.req(`/public/claims/${INV}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.status).toBe("unconfirmed");
    expect(body.confirmation).toMatchObject({ state: "unconfirmed", onchainStatus: null, reason: "chain_unavailable" });
  });

  it("shows the settlement transaction and the buyer's payment record from the chain", async () => {
    const { t, db } = await seed({ status: "settled", closeTxHash: H(3), closedAt: "2026-11-06T11:00:00.000Z" });
    t.chain.claimStates.set(INV, { status: "settled", received: 1n, toHolder: 1n, fundBy: 0n });
    await db.insert(payments).values({ id: "p1", invoiceId: INV, payer: BUYER, value: "100000000", txHash: H(3), logIndex: 0, blockNumber: 5, createdAt: STAMP });
    t.chain.reputation.set(BUYER, { onTime: 8, late: 2, volume: 1n, score: 80 });
    const body = await json(await t.req(`/public/claims/${INV}`));
    expect(body.status).toBe("settled");
    expect(body.transactions.close).toEqual({ kind: "settled", txHash: H(3), url: `https://explorer.testnet.whitechain.io/tx/${H(3)}` });
    expect(body.payerRecord).toEqual({ score: 80, paid: 10 });
    expect(JSON.stringify(body)).not.toContain(BUYER);
  });

  it("uses the buyer business's address when the invoice names one, and survives a reputation lookup failure", async () => {
    const { t, db } = await seed();
    await db.insert(merchants).values({ id: "m_buyer", name: "Buyer Co", address: BUYER, payoutAddress: BUYER, createdAt: STAMP });
    await db.update(invoices).set({ buyerMerchantId: "m_buyer" });
    t.chain.reputation.set(BUYER, { onTime: 1, late: 0, volume: 1n, score: 100 });
    expect((await json(await t.req(`/public/claims/${INV}`))).payerRecord).toEqual({ score: 100, paid: 1 });
    t.chain.reputationOf = async () => { throw new Error("down"); };
    const again = await t.req(`/public/claims/${INV}`);
    expect(again.status).toBe(200);
    expect((await json(again)).payerRecord).toBeNull();
  });

  it("tenant isolation: another business's invoice number stays hidden even when this one chose to show its own", async () => {
    const { t, db } = await seed({}, { show: true });
    const OTHER = `0x${"ef".repeat(32)}`;
    await db.insert(merchants).values({ id: "m_2", name: "Other", address: "0x9999999999999999999999999999999999999999", payoutAddress: "0x9999999999999999999999999999999999999999", createdAt: STAMP });
    await db.insert(invoices).values({ id: OTHER, merchantId: "m_2", number: "OTHER-PRIVATE-1", status: "open", amount: "50000000", metaHash: H(0), createdAt: STAMP, updatedAt: STAMP });
    await db.insert(claims).values({
      id: "cl_2", invoiceId: OTHER, merchantId: "m_2", status: "listed", discountBps: 300, reserveBps: 0, face: "50000000", price: "48500000", reserve: "0",
      dueDate: NOW_S + 86_400 * 10, deadline: NOW_S + 86_400, termsChallenge: "x", hookChallenge: "y", expiresAt: NOW_S + 1, createdAt: STAMP, updatedAt: STAMP,
    });
    t.chain.claimStates.set(OTHER, { status: "listed", received: 0n, toHolder: 0n, fundBy: 0n });
    const text = await (await t.req(`/public/claims/${OTHER}`)).text();
    expect(text).not.toContain("OTHER-PRIVATE-1");
    expect(JSON.parse(text).invoiceNumber).toBeNull();
    expect(JSON.parse(text).face).toBe("50");
  });

  it("is rate limited", async () => {
    const { t } = await seed();
    let last = 200;
    for (let i = 0; i < 130; i++) last = (await t.req(`/public/claims/${INV}`, { headers: { "cf-connecting-ip": "9.9.9.9" } })).status;
    expect(last).toBe(429);
  });

  it("allows our app's origin (CORS) like the other public endpoints", async () => {
    const { t } = await seed();
    const res = await t.req(`/public/claims/${INV}`, { headers: { origin: "https://app.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.test");
  });
});
