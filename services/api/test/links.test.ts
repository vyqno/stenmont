import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";

const post = (t: ReturnType<typeof setup>, key: string, body: unknown) =>
  t.req("/v1/payment-links", { method: "POST", key, body: JSON.stringify(body) });

describe("payment links", () => {
  it("creates a fixed-amount link with a generated slug and resolves it publicly", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const res = await post(t, key, { amount: "25", reusable: true });
    expect(res.status).toBe(201);
    const link = (await res.json()) as { slug: string; url: string };
    expect(link.slug).toMatch(/^[a-z0-9]{8}$/);
    expect(link.url).toBe(`https://app.test/l/${link.slug}`);
    const pub = await t.req(`/l/${link.slug}`);
    expect(pub.status).toBe(200);
    expect(await pub.json()).toMatchObject({ slug: link.slug, amount: "25", reusable: true, merchantName: "Acme" });
  });
  it("accepts a link without an amount (customer chooses) and a custom slug; slugs are unique", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const ok = await post(t, key, { slug: "coffee-fund" });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { amount: string | null }).amount).toBeNull();
    const dup = await post(t, key, { slug: "coffee-fund" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: { code: string } }).error.code).toBe("slug_taken");
  });
  it.each([["bad amount", { amount: "0" }], ["bad slug", { slug: "Has Spaces" }], ["short slug", { slug: "ab" }], ["unknown field", { x: 1 }]])(
    "rejects %s",
    async (_n, payload) => {
      const t = setup();
      const key = await seedMerchant(t.db);
      expect((await post(t, key, payload)).status).toBe(400);
    },
  );
  it("lists only the caller's links; unknown or inactive slugs are 404", async () => {
    const t = setup();
    const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
    const b = await seedMerchant(t.db, "m_2", "Beta", `sk_test_${"b".repeat(32)}`);
    await post(t, a, { slug: "alpha-link" });
    await post(t, b, { slug: "beta-link" });
    const list = (await (await t.req("/v1/payment-links", { key: a })).json()) as { data: { slug: string }[] };
    expect(list.data.map((l) => l.slug)).toEqual(["alpha-link"]);
    expect((await t.req("/l/missing-slug")).status).toBe(404);
    await t.db.prepare("update payment_links set active = 0 where slug = 'alpha-link'").run();
    expect((await t.req("/l/alpha-link")).status).toBe(404);
  });
});
