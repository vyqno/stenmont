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

it("keeps the wordmark moderate and non-bold and separates the selected display and text faces", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const logo = css.match(/\.logo\s*\{([^}]+)/)?.[1] ?? "";
  expect(logo).toContain('font-family: "all-round-gothic"');
  expect(logo).toContain("font-weight: 400");
  expect(css).toContain("font-synthesis: none");
});
