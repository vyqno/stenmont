import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./../helpers/app";

type T = ReturnType<typeof setup>;
const call = (t: T, key: string, method: string, path: string, body?: unknown) =>
  t.req(path, { method, key, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const shirt = {
  title: "Blue Shirt",
  descriptionHtml: '<p onclick="x()">Soft <b>cotton</b></p><script>alert(1)</script>',
  vendor: "Acme",
  status: "active",
  tags: ["summer", "sale"],
  images: [{ url: "https://cdn.example/a.png", alt: "front" }],
  variants: [
    { title: "S", sku: "SH-S", price: "19.99", inventory: 3, options: { Size: "S" } },
    { title: "M", sku: "SH-M", price: "19.99", inventory: 0, options: { Size: "M" } },
  ],
};

async function twoMerchants() {
  const t = setup();
  const a = await seedMerchant(t.db, "m_1", "Acme", `sk_test_${"a".repeat(32)}`);
  const b = await seedMerchant(t.db, "m_2", "Other", `sk_test_${"b".repeat(32)}`);
  return { t, a, b };
}

describe("store settings", () => {
  it("sets a slug once and refuses a taken or malformed one", async () => {
    const { t, a, b } = await twoMerchants();
    expect((await call(t, a, "PUT", "/v1/store", { slug: "acme-shop", name: "Acme Shop" })).status).toBe(200);
    expect(await (await call(t, a, "GET", "/v1/store")).json()).toMatchObject({ slug: "acme-shop", name: "Acme Shop" });
    expect((await call(t, b, "PUT", "/v1/store", { slug: "acme-shop", name: "Copycat" })).status).toBe(409);
    for (const slug of ["A", "-x-", "a b", "x".repeat(41), "a/../b"]) {
      expect((await call(t, b, "PUT", "/v1/store", { slug, name: "N" })).status).toBe(400);
    }
  });
});

describe("store display note", () => {
  it("is optional, can be cleared, is capped, and is shown to shoppers only when set", async () => {
    const { t, a } = await twoMerchants();
    await call(t, a, "PUT", "/v1/store", { slug: "acme", name: "Acme Shop" });
    expect(((await (await t.req("/store/acme/products")).json()) as any).store).toEqual({ slug: "acme", name: "Acme Shop" });
    expect((await call(t, a, "PUT", "/v1/store", { slug: "acme", name: "Acme Shop", displayNote: "Prices in dollars, paid in USDT" })).status).toBe(200);
    expect(await (await call(t, a, "GET", "/v1/store")).json()).toMatchObject({ displayNote: "Prices in dollars, paid in USDT" });
    expect(((await (await t.req("/store/acme/products")).json()) as any).store.displayNote).toBe("Prices in dollars, paid in USDT");
    expect((await call(t, a, "PUT", "/v1/store", { slug: "acme", name: "Acme Shop", displayNote: "x".repeat(201) })).status).toBe(400);
    await call(t, a, "PUT", "/v1/store", { slug: "acme", name: "Acme Shop", displayNote: "" });
    expect(((await (await t.req("/store/acme/products")).json()) as any).store).toEqual({ slug: "acme", name: "Acme Shop" });
  });
});

describe("products", () => {
  it("creates a product with variants and images, sanitising the description", async () => {
    const { t, a } = await twoMerchants();
    const res = await call(t, a, "POST", "/v1/products", shirt);
    expect(res.status).toBe(201);
    const p = (await res.json()) as any;
    expect(p.handle).toBe("blue-shirt");
    expect(p.descriptionHtml).toBe("<p>Soft <b>cotton</b></p>");
    expect(p.variants).toHaveLength(2);
    expect(p.variants[0]).toMatchObject({ sku: "SH-S", price: "19.99", inventory: 3 });
    expect(p.images).toEqual([{ url: "https://cdn.example/a.png", alt: "front", position: 1 }]);
  });

  it("validates input", async () => {
    const { t, a } = await twoMerchants();
    const bad = [
      { ...shirt, title: "" },
      { ...shirt, handle: "Bad Handle" },
      { ...shirt, status: "live" },
      { ...shirt, variants: [{ price: "-1", inventory: 1 }] },
      { ...shirt, variants: [{ price: "1.1234567", inventory: 1 }] },
      { ...shirt, variants: [{ price: "20000000", inventory: 1 }] },
      { ...shirt, variants: [{ price: "1", inventory: -1 }] },
      { ...shirt, variants: [] },
      { ...shirt, images: [{ url: "javascript:alert(1)" }] },
      { ...shirt, images: [{ url: "http://insecure.example/a.png" }] },
      { ...shirt, surprise: 1 },
    ];
    for (const body of bad) expect((await call(t, a, "POST", "/v1/products", body)).status).toBe(400);
  });

  it("refuses a second product with the same handle", async () => {
    const { t, a } = await twoMerchants();
    expect((await call(t, a, "POST", "/v1/products", shirt)).status).toBe(201);
    expect((await call(t, a, "POST", "/v1/products", shirt)).status).toBe(409);
  });

  it("requires authentication", async () => {
    const { t } = await twoMerchants();
    expect((await t.req("/v1/products")).status).toBe(401);
  });

  it("updates a product and its variant price and inventory", async () => {
    const { t, a } = await twoMerchants();
    const p = (await (await call(t, a, "POST", "/v1/products", shirt)).json()) as any;
    const up = await call(t, a, "PATCH", `/v1/products/${p.id}`, { title: "Navy Shirt", status: "draft", descriptionHtml: "<img src=x onerror=1>hi" });
    expect(await up.json()).toMatchObject({ title: "Navy Shirt", status: "draft", descriptionHtml: "hi" });
    const v = await call(t, a, "PATCH", `/v1/variants/${p.variants[0].id}`, { price: "25", inventory: 9 });
    expect(await v.json()).toMatchObject({ price: "25", inventory: 9 });
  });

  it("adds and removes variants, and archives a product on delete", async () => {
    const { t, a } = await twoMerchants();
    const p = (await (await call(t, a, "POST", "/v1/products", shirt)).json()) as any;
    const add = await call(t, a, "POST", `/v1/products/${p.id}/variants`, { title: "L", price: "21", inventory: 5 });
    expect(add.status).toBe(201);
    const nv = (await add.json()) as any;
    expect((await call(t, a, "DELETE", `/v1/variants/${nv.id}`)).status).toBe(200);
    expect((await call(t, a, "DELETE", `/v1/products/${p.id}`)).status).toBe(200);
    expect(await (await call(t, a, "GET", `/v1/products/${p.id}`)).json()).toMatchObject({ status: "archived" });
  });

  it("lists only the caller's products", async () => {
    const { t, a, b } = await twoMerchants();
    await call(t, a, "POST", "/v1/products", shirt);
    await call(t, b, "POST", "/v1/products", { ...shirt, title: "Other Hat" });
    const mine = (await (await call(t, a, "GET", "/v1/products")).json()) as any;
    expect(mine.data.map((p: any) => p.title)).toEqual(["Blue Shirt"]);
  });
});

describe("tenant isolation", () => {
  it("never lets one business read or change another's catalogue", async () => {
    const { t, a, b } = await twoMerchants();
    const p = (await (await call(t, a, "POST", "/v1/products", shirt)).json()) as any;
    const vid = p.variants[0].id;
    expect((await call(t, b, "GET", `/v1/products/${p.id}`)).status).toBe(404);
    expect((await call(t, b, "PATCH", `/v1/products/${p.id}`, { title: "Hacked" })).status).toBe(404);
    expect((await call(t, b, "DELETE", `/v1/products/${p.id}`)).status).toBe(404);
    expect((await call(t, b, "PATCH", `/v1/variants/${vid}`, { price: "0.01" })).status).toBe(404);
    expect((await call(t, b, "DELETE", `/v1/variants/${vid}`)).status).toBe(404);
    expect((await call(t, b, "POST", `/v1/products/${p.id}/variants`, { price: "1", inventory: 1 })).status).toBe(404);
    expect(await (await call(t, a, "GET", `/v1/products/${p.id}`)).json()).toMatchObject({ title: "Blue Shirt" });
  });
});

describe("public store API", () => {
  async function published() {
    const ctx = await twoMerchants();
    await call(ctx.t, ctx.a, "PUT", "/v1/store", { slug: "acme", name: "Acme Shop" });
    await call(ctx.t, ctx.a, "POST", "/v1/products", shirt);
    await call(ctx.t, ctx.a, "POST", "/v1/products", { ...shirt, title: "Hidden Draft", status: "draft" });
    return ctx;
  }

  it("lists active products without private fields, and needs no key", async () => {
    const { t } = await published();
    const res = await t.req("/store/acme/products");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.store).toEqual({ slug: "acme", name: "Acme Shop" });
    expect(body.data.map((p: any) => p.handle)).toEqual(["blue-shirt"]);
    const text = JSON.stringify(body);
    for (const secret of ["m_1", "SH-S", "externalId", "merchantId", "merchant_id"]) expect(text).not.toContain(secret);
    expect(body.data[0].variants.map((v: any) => [v.title, v.price, v.available])).toEqual([["S", "19.99", true], ["M", "19.99", false]]);
    expect(body.data[0].variants[0]).not.toHaveProperty("inventory");
  });

  it("serves one product by handle, and 404s for drafts, other stores and unknown slugs", async () => {
    const { t } = await published();
    expect((await t.req("/store/acme/products/blue-shirt")).status).toBe(200);
    expect((await t.req("/store/acme/products/hidden-draft")).status).toBe(404);
    expect((await t.req("/store/nope/products")).status).toBe(404);
    expect((await t.req("/store/acme/products/does-not-exist")).status).toBe(404);
  });

  it("does not show another store's product under this slug", async () => {
    const { t, b } = await published();
    await call(t, b, "PUT", "/v1/store", { slug: "other", name: "Other" });
    await call(t, b, "POST", "/v1/products", { ...shirt, title: "Other Hat" });
    expect((await t.req("/store/acme/products/other-hat")).status).toBe(404);
    expect((await t.req("/store/other/products/blue-shirt")).status).toBe(404);
  });
});
