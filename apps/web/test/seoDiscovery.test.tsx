import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import sitemap from "../app/sitemap";
import docsSitemap from "../app/docs/sitemap";
import robots from "../app/robots";
import { SiteStructuredData } from "../components/SiteStructuredData";

it("serves a public/docs-only discovery inventory and disallows staging crawling", () => {
  const all = sitemap().map(r => r.url);
  const docs = docsSitemap().map(r => r.url);
  expect(all).toContain("https://app-staging.stenmont.com");
  expect(docs).toHaveLength(7);
  expect(docs.every(p => p.startsWith("https://app-staging.stenmont.com/docs"))).toBe(true);
  expect(all.filter(p => /account|dashboard|pay\/|store\/|invest|oauth/.test(p))).toEqual([]);
  expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
});
it("describes the real organization and test-network software without unsupported ratings or commercial offers", () => {
  const html = renderToStaticMarkup(<SiteStructuredData />);
  const data = JSON.parse(html.match(/>([\s\S]*?)<\/script>/)![1]!);
  expect(data["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "SoftwareApplication"]);
  expect(html).toContain("test network");
  expect(html).not.toMatch(/aggregateRating|offers|priceCurrency|customer|invoiceId|wordmark-social/);
});
