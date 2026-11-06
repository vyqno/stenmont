import { describe, expect, it } from "vitest";
import { auditLog, claims, investorEnrollments, invoices, payments } from "../src/db/schema";
import { seedMerchant, setup } from "./helpers/app";
import { dbOf } from "./helpers/fixtures";

const INV = `0x${"ab".repeat(32)}`;
const INV2 = `0x${"cd".repeat(32)}`;
const H = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const INVESTOR = "0x4444444444444444444444444444444444444444";
const NOW_S = Math.floor(new Date("2026-11-06T12:00:00Z").getTime() / 1000);
const STAMP = "2026-11-06T10:00:00.000Z";
const json = async (r: Response) => (await r.json()) as Record<string, any>;

async function world() {
  const t = setup();
  const key = await seedMerchant(t.db, "m_1", "Acme");
  const key2 = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  const db = dbOf(t.db);
  const addInvoice = (id: string, merchantId: string, number: string) =>
    db.insert(invoices).values({ id, merchantId, number, status: "open", amount: "100000000", amountPaid: "0", metaHash: H(0), createdAt: STAMP, updatedAt: STAMP });
  const addClaim = (id: string, invoiceId: string, merchantId: string, over: Partial<typeof claims.$inferInsert> = {}) =>
    db.insert(claims).values({
      id, invoiceId, merchantId, status: "funded", discountBps: 500, reserveBps: 1000, face: "100000000", price: "95000000", reserve: "10000000",
      dueDate: NOW_S + 86_400 * 30, deadline: NOW_S + 86_400, termsChallenge: "T", hookChallenge: "H", expiresAt: NOW_S + 1, investor: INVESTOR,
      listTxHash: H(1), fundTxHash: H(2), listedAt: "2026-11-06T10:01:00.000Z", fundedAt: "2026-11-06T10:05:00.000Z", createdAt: STAMP, updatedAt: STAMP, ...over,
    });
  return { t, key, key2, db, addInvoice, addClaim };
}

describe("GET /v1/financing/timeline", () => {
  it("returns, per financed invoice, what each step needs: amounts, times, transactions, investor and payments", async () => {
    const { t, key, db, addInvoice, addClaim } = await world();
    await addInvoice(INV, "m_1", "INV-1");
    await addClaim("cl_1", INV, "m_1", { status: "settled", closeTxHash: H(3), closedAt: "2026-11-06T11:00:00.000Z" });
    await db.update(invoices).set({ status: "paid", amountPaid: "100000000" });
    await db.insert(payments).values({ id: "p1", invoiceId: INV, payer: "0x7777777777777777777777777777777777777777", value: "100000000", txHash: H(3), logIndex: 0, blockNumber: 9, createdAt: "2026-11-06T11:00:00.000Z" });
    await db.insert(investorEnrollments).values({ address: INVESTOR, action: "allow-investor", nullifier: "SECRET-NULLIFIER", verifiedAt: "2026-11-06T09:00:00.000Z" });
    await db.insert(auditLog).values({ merchantId: null, actor: `investor:${INVESTOR}`, action: "investor.allowed", payload: JSON.stringify({ account: INVESTOR, txHash: H(7) }), createdAt: "2026-11-06T09:00:05.000Z" });

    const res = await t.req("/v1/financing/timeline", { key });
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    const [item] = (await json(res)).items;
    expect(item).toMatchObject({
      claimId: "cl_1", invoiceId: INV, invoiceNumber: "INV-1", status: "settled", invoiceStatus: "paid", showInvoiceNumber: false,
      face: "100", price: "95", discount: "5", reserve: "10", advance: "85", discountBps: 500, reserveBps: 1000, amountPaid: "100",
      investor: { address: INVESTOR, verified: true, allowTx: H(7), verifiedAt: "2026-11-06T09:00:00.000Z" },
      times: { listedAt: "2026-11-06T10:01:00.000Z", fundedAt: "2026-11-06T10:05:00.000Z", closedAt: "2026-11-06T11:00:00.000Z" },
      transactions: { list: H(1), fund: H(2), close: H(3) },
      payments: [{ value: "100", txHash: H(3), at: "2026-11-06T11:00:00.000Z" }],
    });
    expect(text).not.toContain("SECRET-NULLIFIER");
    expect(text).not.toContain("CHALLENGE");
  });

  it("leaves out requests nobody signed, and shows only this business's claims", async () => {
    const { t, key, key2, addInvoice, addClaim } = await world();
    await addInvoice(INV, "m_1", "INV-1");
    await addInvoice(INV2, "m_2", "OTHER-1");
    await addClaim("cl_1", INV, "m_1");
    await addClaim("cl_2", INV2, "m_2", { listTxHash: H(8) });
    await addClaim("cl_3", INV, "m_1", { status: "pending" });
    const mine = (await json(await t.req("/v1/financing/timeline", { key }))).items;
    expect(mine.map((i: any) => i.claimId)).toEqual(["cl_1"]);
    const theirs = (await json(await t.req("/v1/financing/timeline", { key: key2 }))).items;
    expect(theirs.map((i: any) => i.claimId)).toEqual(["cl_2"]);
    expect(JSON.stringify(theirs)).not.toContain("INV-1");
  });

  it("works for a listed claim that has no investor yet", async () => {
    const { t, key, addInvoice, addClaim } = await world();
    await addInvoice(INV, "m_1", "INV-1");
    await addClaim("cl_1", INV, "m_1", { status: "listed", investor: null, fundTxHash: null, fundedAt: null });
    const [item] = (await json(await t.req("/v1/financing/timeline", { key }))).items;
    expect(item).toMatchObject({ status: "listed", investor: null, payments: [], transactions: { list: H(1), fund: null, close: null } });
  });

  it("needs sign-in", async () => {
    const { t } = await world();
    expect((await t.req("/v1/financing/timeline")).status).toBe(401);
  });
});

describe("POST /v1/financing/listings/:id/public-number (show the invoice number on the public certificate)", () => {
  const post = (t: Awaited<ReturnType<typeof world>>["t"], key: string, id: string, body: unknown) =>
    t.req(`/v1/financing/listings/${id}/public-number`, { method: "POST", key, body: JSON.stringify(body) });

  it("lets the business turn the invoice number on and off, and records it", async () => {
    const { t, key, db, addInvoice, addClaim } = await world();
    await addInvoice(INV, "m_1", "INV-1");
    await addClaim("cl_1", INV, "m_1");
    expect((await post(t, key, "cl_1", { showInvoiceNumber: true })).status).toBe(200);
    expect((await db.select().from(claims))[0]!.showInvoiceNumber).toBe(1);
    expect((await json(await t.req(`/public/claims/${INV}`))).invoiceNumber).toBe("INV-1");
    expect((await post(t, key, "cl_1", { showInvoiceNumber: false })).status).toBe(200);
    expect((await json(await t.req(`/public/claims/${INV}`))).invoiceNumber).toBeNull();
    expect((await db.select().from(auditLog)).filter((a) => a.action === "claim.public_number")).toHaveLength(2);
  });

  it("refuses another business's claim, unknown ids and bad bodies", async () => {
    const { t, key, key2, db, addInvoice, addClaim } = await world();
    await addInvoice(INV, "m_1", "INV-1");
    await addClaim("cl_1", INV, "m_1");
    expect((await post(t, key2, "cl_1", { showInvoiceNumber: true })).status).toBe(404);
    expect((await db.select().from(claims))[0]!.showInvoiceNumber).toBe(0);
    expect((await post(t, key, "cl_nope", { showInvoiceNumber: true })).status).toBe(404);
    expect((await post(t, key, "cl_1", { showInvoiceNumber: "yes" })).status).toBe(400);
    expect((await post(t, key, "cl_1", { showInvoiceNumber: true, extra: 1 })).status).toBe(400);
  });
});
