import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";

const create = (t: ReturnType<typeof setup>, key: string, body: object) =>
  t.req("/v1/invoices", { method: "POST", key, idem: crypto.randomUUID(), body: JSON.stringify(body) });

describe("GET /pay/:id (public)", () => {
  it("returns what the pay page needs and nothing internal", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const inv = (await (await create(t, key, { amount: "12.50", number: "INV-1", customerEmail: "secret@x.co" })).json()) as { id: string };
    const res = await t.req(`/pay/${inv.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: inv.id, number: "INV-1", status: "open", amount: "12.5", amountPaid: "0", remaining: "12.5", merchantName: "Acme" });
    expect(JSON.stringify(body)).not.toContain("secret@x.co");
    expect(body).not.toHaveProperty("merchantId");
    expect(body).not.toHaveProperty("metadata");
  });
  it("shows remaining after a partial payment, and 404 for unknown or malformed ids", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const inv = (await (await create(t, key, { amount: "10", number: "INV-1" })).json()) as { id: string };
    await t.db.prepare("update invoices set amount_paid = '4000000', status = 'partially_paid'").run();
    const body = (await (await t.req(`/pay/${inv.id}`)).json()) as { remaining: string; status: string };
    expect(body).toMatchObject({ remaining: "6", status: "partially_paid" });
    expect((await t.req(`/pay/0x${"0".repeat(64)}`)).status).toBe(404);
    expect((await t.req("/pay/not-an-id")).status).toBe(404);
  });
  it("does not show invoices that failed to be created onchain", async () => {
    const t = setup({ async createInvoice() { throw new Error("down"); } });
    const key = await seedMerchant(t.db);
    await create(t, key, { amount: "1", number: "INV-F" });
    const row = (await t.db.prepare("select id from invoices").first()) as { id: string };
    expect((await t.req(`/pay/${row.id}`)).status).toBe(404);
  });
});
