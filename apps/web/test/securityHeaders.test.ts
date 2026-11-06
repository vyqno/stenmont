import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import config from "../next.config";
import { securityHeaders } from "../lib/securityHeaders";

afterEach(() => vi.unstubAllEnvs());
describe("web response security boundaries", () => {
  it("wires enforcing baseline headers through Next configuration", async () => {
    const rules = await config.headers!();
    expect(rules).toEqual(securityHeaders());
    const general = new Headers(rules[0]!.headers.map((h): [string, string] => [h.key, h.value]));
    expect(general.get("x-content-type-options")).toBe("nosniff");
    expect(general.get("x-frame-options")).toBe("DENY");
    expect(general.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(general.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(general.get("content-security-policy")).toBe("object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    expect(general.get("permissions-policy")).not.toMatch(/publickey|payment|camera|microphone/);
  });
  it("keeps the unproven script policy report-only and permits existing webfont and identity hosts", () => {
    const general = new Headers(securityHeaders()[0]!.headers.map((h): [string, string] => [h.key, h.value]));
    const candidate = general.get("content-security-policy-report-only")!;
    expect(candidate).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
    expect(candidate).toContain("https://use.typekit.net");
    expect(candidate).toContain("https://simulator.worldcoin.org");
    expect(candidate).toContain("https://world-id-assets.com");
    expect(general.get("content-security-policy")).not.toContain("script-src");
  });
  it("serves hashed build assets as immutable for a year through the Cloudflare assets headers file", () => {
    const file = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
    expect(file).toMatch(/^\/_next\/static\/\*\n[ \t]+Cache-Control: public, max-age=31536000, immutable$/m);
    expect(file).not.toMatch(/^\/\*/m);
  });
  it("sets no-referrer on private, payment and authorization route families", () => {
    const rules = securityHeaders();
    for (const route of ["/account", "/pay/:path*", "/subscribe/:path*", "/claim/:path*", "/invest/:path*", "/dashboard/:path*", "/oauth/:path*", "/login", "/signup", "/store/:path*"]) {
      expect(rules.find(r => r.source === route)?.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
    }
  });
  it("never reflects configured origin text into headers or permits CRLF injection", () => {
    vi.stubEnv("STENMONT_PUBLIC_ORIGIN", "https://evil.invalid\r\nX-Injected: yes");
    vi.stubEnv("API_URL", "https://evil.invalid\nContent-Security-Policy: default-src *");
    for (const rule of securityHeaders()) for (const header of rule.headers) {
      expect(header.value).not.toMatch(/[\r\n]|evil\.invalid|X-Injected/);
      expect(() => new Headers([[header.key, header.value]])).not.toThrow();
    }
  });
});
