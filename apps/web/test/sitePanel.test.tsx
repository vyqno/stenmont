import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SitePanel } from "../app/dashboard/connect/SitePanel";
import type { Site } from "../lib/sites";

const site: Site = {
  id: "s1",
  url: "https://shop.example.com",
  host: "shop.example.com",
  platform: null,
  createdAt: "2026-11-06T10:00:00.000Z",
  verification: { recordName: "_stenmont.shop.example.com", recordValue: "stenmont-verify=abc123" },
  checks: {
    reachable: { ok: true, detail: "shop.example.com answered 200.", checkedAt: "2026-11-06T10:05:00.000Z" },
    domain: { ok: false, detail: "No TXT record found.", checkedAt: "2026-11-06T10:05:01.000Z" },
    webhook: null,
    payment: null,
  },
  ready: false,
};

describe("site status panel", () => {
  const html = renderToStaticMarkup(<SitePanel sites={[site]} reload={() => {}} loadError={null} />);
  it("shows each check with words, not only colour, and its time", () => {
    expect(html).toContain("Passed");
    expect(html).toContain("Not passed");
    expect(html).toContain("Not checked");
    expect(html).toContain('dateTime="2026-11-06T10:05:00.000Z"');
    expect(html).toContain("1 of 4 checks passed");
  });
  it("tells the owner the exact DNS record to add", () => {
    expect(html).toContain("_stenmont.shop.example.com");
    expect(html).toContain("stenmont-verify=abc123");
  });
  it("says what to do when nothing is registered, and shows a load error", () => {
    expect(renderToStaticMarkup(<SitePanel sites={[]} reload={() => {}} loadError={null} />)).toContain("No site yet");
    expect(renderToStaticMarkup(<SitePanel sites={null} reload={() => {}} loadError="Network down" />)).toContain("Network down");
  });
  it("marks a site with every check passed as ready", () => {
    const ready = { ...site, ready: true, checks: { reachable: site.checks.reachable, domain: site.checks.reachable, webhook: site.checks.reachable, payment: site.checks.reachable } };
    expect(renderToStaticMarkup(<SitePanel sites={[ready]} reload={() => {}} loadError={null} />)).toContain("Ready");
  });
});
