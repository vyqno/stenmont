import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../app/page";

describe("landing product examples", () => {
  it("keeps the story steps with described pictures, the platform marks, and offers semantic developer tabs", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Signed webhook answered 200");
    expect(html).toContain("Tokenize what you");
    for (const mark of ["Shopify", "WooCommerce", "Webflow"]) expect(html).toContain(mark);
    for (const step of ["Bring your store", "Customers pay with one tap", "One person, one business", "A name that carries the rules", "Get paid before the customer does"]) expect(html).toContain(step);
    for (const tab of ["Take a payment", "Confirm it", "Sell an invoice", "Limit an agent"]) expect(html).toContain(tab);
    expect(html).toContain("Bring your catalogue.");
    expect(html).toContain("One-click connect to Shopify works on the test network");
    expect(html).toContain("Funding is not guaranteed.");
  });
});

it("keeps the wordmark moderate and non-bold and separates the selected display and text faces", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const logo = css.match(/\.logo\s*\{([^}]+)/)?.[1] ?? "";
  expect(logo).toContain('font-family: "all-round-gothic"');
  expect(logo).toContain("font-weight: 400");
  expect(css).toContain("font-synthesis: none");
});
