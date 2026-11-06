import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayButton } from "../src";

describe("PayButton", () => {
  it("is a link to the checkout page with a default label", () => {
    const html = renderToStaticMarkup(<PayButton sessionUrl="https://app.stenmont.com/pay/0xabc" />);
    expect(html).toContain('href="https://app.stenmont.com/pay/0xabc"');
    expect(html).toContain(">Pay<");
  });
  it("takes custom children and a class name", () => {
    const html = renderToStaticMarkup(<PayButton sessionUrl="https://app.test/pay/1" className="btn">Pay $5.00</PayButton>);
    expect(html).toContain("Pay $5.00");
    expect(html).toContain('class="btn"');
  });
  it("never renders a link that is not http(s), so a bad value cannot run script", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "", "//evil.example"]) {
      const html = renderToStaticMarkup(<PayButton sessionUrl={bad} />);
      expect(html).not.toContain("href");
      expect(html).toContain("disabled");
    }
  });
});
