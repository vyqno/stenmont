import { describe, expect, it } from "vitest";
import { pageMetadata, siteConfig, sitemapEntries, robotsPolicy, safeJsonLd, ROUTES } from "../lib/seo";

describe("public discovery without exposing private billing routes", () => {
  it("keeps staging non-indexable even when an indexing flag is supplied", () => {
    const staging = siteConfig({ origin: "https://app-staging.stenmont.com", indexPublic: "yes" });
    expect(staging.indexPublic).toBe(false);
    expect(robotsPolicy(staging).rules).toEqual({ userAgent: "*", disallow: "/" });
    expect(pageMetadata("/docs", staging).robots).toMatchObject({ index: false, follow: false });
    expect(siteConfig({ origin: "https://evil.example", indexPublic: "yes" }).origin).toBe("https://app-staging.stenmont.com");
  });
  it("only indexes explicitly enabled public marketing and documentation on an approved host", () => {
    const site = siteConfig({ origin: "https://stenmont.com", indexPublic: "yes" });
    expect(pageMetadata("/docs/api", site).alternates).toEqual({ canonical: "https://stenmont.com/docs/api" });
    expect(pageMetadata("/docs/api", site).robots).toMatchObject({ index: true });
    const urls = sitemapEntries(site).map(x => x.url);
    expect(urls).toContain("https://stenmont.com/docs/faq");
    expect(urls.every(x => x === site.origin || x.startsWith(`${site.origin}/docs`))).toBe(true);
    for (const path of ["/account", "/pay/[id]", "/claim/[id]", "/dashboard/invoices", "/store/[slug]", "/oauth/authorize"]) {
      const m = pageMetadata(path as keyof typeof ROUTES, site);
      expect(m.robots).toMatchObject({ index: false, follow: false });
      expect(m.alternates).toBeUndefined();
      expect(m.openGraph).not.toHaveProperty("url");
    }
  });
  it("gives each route distinct share metadata with the verified non-bold wordmark asset", () => {
    const titles = Object.keys(ROUTES).map(path => pageMetadata(path as keyof typeof ROUTES).title);
    expect(new Set(titles).size).toBe(titles.length);
    const m = pageMetadata("/pay/[id]");
    expect(m.openGraph).toMatchObject({ images: [{ url: "/brand/wordmark-social.png", width: 1200, height: 630, alt: "stenmont" }] });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["/brand/wordmark-social.png"] });
    expect(JSON.stringify(m)).not.toMatch(/\[id\]|token|invoiceId/);
  });
  it("serializes JSON-LD without a script breakout or HTML parser separators", () => {
    const value = { answer: "</script><script>alert(1)</script>\u2028\u2029" };
    const json = safeJsonLd(value);
    expect(json).not.toContain("<");
    expect(json).not.toContain("\u2028");
    expect(JSON.parse(json)).toEqual(value);
  });
});
