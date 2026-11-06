import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FundingHelp from "../components/FundingHelp";

describe("funding help prerender", () => {
  it("can render the account page's funding help without browser globals", () => {
    expect(() => renderToStaticMarkup(<FundingHelp />)).not.toThrow();
  });
});
