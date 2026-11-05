import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "../app/page";

describe("landing page", () => {
  it("shows the product line", () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain("Stenmont");
    expect(html).toContain("settled in seconds");
  });
});
