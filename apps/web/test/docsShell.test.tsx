import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DocsLayout from "../app/docs/layout";

describe("docs shell", () => {
  it("offers the actual full reference and a copy-page action", () => {
    const html = renderToStaticMarkup(<DocsLayout><h1>Quickstart</h1></DocsLayout>);
    expect(html).toContain('href="/llms-full.txt"');
    expect(html).toContain("Open in…");
    expect(html).toContain("Copy page");
    expect(html).toContain('aria-label="Documentation sections"');
    expect(html).toContain('id="docs-content"');
  });
});
