import { expect, it } from "vitest";
import { handleStenmontEvent } from "../src/stenmontWebhook";
import { world } from "./fakes";
import { env } from "./helpers";

it.each([
  { name: "increased total", amount: "99.00", currency: "USD", reason: "price_changed" },
  { name: "changed currency at the same converted amount", amount: "850.00", currency: "INR", reason: "price_changed" },
  { name: "unconvertible price", amount: "bad", currency: "USD", reason: "price_not_convertible" },
])("leaves an order unpaid after its $name", async ({ amount, currency, reason }) => {
  const id = "gid://shopify/Order/2001";
  const w = world({ orders: { [id]: { amount, currency } } });
  const e = env({ RATE_PER_USD: "85" });
  const result = await handleStenmontEvent(e, w.d, {
    id: "evt_price_change",
    type: "invoice.paid",
    data: { invoice: { id: "0xinv1", amount: "10.00", metadata: { shop: "demo-shop.myshopify.com", orderId: id, shopifyCurrency: "USD" } } },
  });
  expect(result).toMatchObject({ status: "needs_review", reason });
  expect(w.state.orders.get(id)?.status).toBe("PENDING");
  expect(w.state.ops).not.toContain("manual");
  expect(w.state.ops).not.toContain("markpaid");
});
