import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";

const post = (t: ReturnType<typeof setup>, key: string, body: unknown, idem: string) =>
  t.req("/v1/invoices", { method: "POST", key, idem, body: JSON.stringify(body) });

describe("invoice tax label (display and export only)", () => {
  it("stores taxRate (basis points) and taxLabel and returns them", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await post(t, key, { amount: "12", number: "T-1", taxRate: 2000, taxLabel: "VAT" }, "k1");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ taxRate: 2000, taxLabel: "VAT" });
    const row = await t.db.prepare("select tax_rate_bps, tax_label from invoices where number = 'T-1'").first();
    expect(row).toMatchObject({ tax_rate_bps: 2000, tax_label: "VAT" });
  });
  it("defaults the label to Tax and returns nulls when no tax is set", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    expect(await (await post(t, key, { amount: "5", number: "T-2", taxRate: 500 }, "k1")).json()).toMatchObject({ taxRate: 500, taxLabel: "Tax" });
    expect(await (await post(t, key, { amount: "5", number: "T-3" }, "k2")).json()).toMatchObject({ taxRate: null, taxLabel: null });
  });
  it("rejects bad rates and labels", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    let n = 0;
    for (const bad of [{ taxRate: -1 }, { taxRate: 10001 }, { taxRate: 12.5 }, { taxRate: "20" }, { taxLabel: "VAT" }, { taxRate: 100, taxLabel: "=cmd" }, { taxRate: 100, taxLabel: "x".repeat(21) }]) {
      const res = await post(t, key, { amount: "5", number: `B-${n}`, ...bad }, `bad${n++}`);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(t.chain.calls).toHaveLength(0);
  });
});
