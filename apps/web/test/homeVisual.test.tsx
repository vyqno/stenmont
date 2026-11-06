import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../app/page";

describe("landing product examples", () => {
  it("clearly identifies illustrative financial records and offers semantic feature tabs", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("Sample data");
    expect(html).toContain("Get paid");
    expect(html).toContain("Books");
    expect(html).toContain("Sell invoices");
    expect(html).toContain("Agents");
    expect(html).toContain("Financing depends on investor funding");
  });
});
