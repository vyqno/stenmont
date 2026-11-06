import { describe, expect, it } from "vitest";
import { lookupTxt, resolvesPublic } from "../src/sites/dns";
import { probeSite } from "../src/sites/probe";
import { fakeNet } from "./helpers/net";

describe("lookupTxt (DNS over HTTPS)", () => {
  it("returns the TXT strings with their quotes removed", async () => {
    const net = fakeNet({ txt: { "_stenmont.shop.example.com": ["stenmont-verify=abc", "v=spf1 -all"] } });
    expect(await lookupTxt("_stenmont.shop.example.com", net.fetch)).toEqual({ ok: true, records: ["stenmont-verify=abc", "v=spf1 -all"] });
    expect(net.log[0]!.url).toMatch(/^https:\/\/cloudflare-dns\.com\/dns-query\?/);
    expect(net.log[0]!.headers.accept).toBe("application/dns-json");
  });
  it("joins a record that the resolver split into several strings", async () => {
    const f = (async () => Response.json({ Status: 0, Answer: [{ type: 16, data: '"stenmont-verify=" "abc"' }] })) as unknown as typeof fetch;
    expect(await lookupTxt("x.example.com", f)).toEqual({ ok: true, records: ["stenmont-verify=abc"] });
  });
  it("treats a name with no records as an empty list, not an error", async () => {
    expect(await lookupTxt("nothing.example.com", fakeNet().fetch)).toEqual({ ok: true, records: [] });
  });
  it("reports a failed lookup as a failure, so a DNS outage is not read as 'record missing'", async () => {
    const down = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect((await lookupTxt("x.example.com", down)).ok).toBe(false);
    const servfail = (async () => Response.json({ Status: 2 })) as unknown as typeof fetch;
    expect((await lookupTxt("x.example.com", servfail)).ok).toBe(false);
    const http500 = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect((await lookupTxt("x.example.com", http500)).ok).toBe(false);
  });
});

describe("resolvesPublic", () => {
  it("accepts a name that resolves to public addresses", async () => {
    expect((await resolvesPublic("shop.example.com", fakeNet({ a: { "shop.example.com": ["93.184.216.34", "2606:4700:4700::1111"] } }).fetch)).ok).toBe(true);
  });
  it.each(["127.0.0.1", "10.0.0.8", "169.254.169.254", "192.168.1.9", "::1", "fd00::5"])("refuses a public-looking name that resolves to %s", async (addr) => {
    expect((await resolvesPublic("sneaky.example.com", fakeNet({ a: { "sneaky.example.com": ["93.184.216.34", addr] } }).fetch)).ok).toBe(false);
  });
  it("refuses a name that does not resolve at all", async () => {
    expect((await resolvesPublic("gone.example.com", fakeNet().fetch)).ok).toBe(false);
  });
});

const ok200 = () => new Response("<html></html>", { status: 200 });
const publicNet = (sites: Record<string, (r: Request) => Response>, extra: Record<string, string[]> = {}) =>
  fakeNet({ a: { "shop.example.com": ["93.184.216.34"], "www.shop.example.com": ["93.184.216.34"], "other.example.net": ["93.184.216.34"], ...extra }, sites });

describe("probeSite", () => {
  it("passes for a site that answers 200", async () => {
    const net = publicNet({ "shop.example.com": ok200 });
    const r = await probeSite("https://shop.example.com", net.fetch);
    expect(r.ok).toBe(true);
    const probe = net.log.find((l) => l.url === "https://shop.example.com/")!;
    expect(probe.method).toBe("GET");
    expect(probe.redirect).toBe("manual");
  });
  it("follows a redirect on the same host", async () => {
    const net = publicNet({ "shop.example.com": (r) => (new URL(r.url).pathname === "/" ? new Response(null, { status: 301, headers: { location: "/home" } }) : ok200()) });
    expect((await probeSite("https://shop.example.com", net.fetch)).ok).toBe(true);
  });
  it("fails, and does not follow, a redirect to another host", async () => {
    const net = publicNet({
      "shop.example.com": () => new Response(null, { status: 302, headers: { location: "https://other.example.net/" } }),
      "other.example.net": ok200,
    });
    const r = await probeSite("https://shop.example.com", net.fetch);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("other.example.net");
    expect(net.log.some((l) => l.url.startsWith("https://other.example.net"))).toBe(false);
  });
  it("fails a redirect to plain http or to a private address, and a redirect loop", async () => {
    for (const location of ["http://shop.example.com/", "https://127.0.0.1/", "https://169.254.169.254/"]) {
      const net = publicNet({ "shop.example.com": () => new Response(null, { status: 302, headers: { location } }) });
      expect((await probeSite("https://shop.example.com", net.fetch)).ok).toBe(false);
      expect(net.log.some((l) => l.url.includes("169.254") || l.url.includes("127.0.0.1"))).toBe(false);
    }
    const loop = publicNet({ "shop.example.com": () => new Response(null, { status: 302, headers: { location: "/again" } }) });
    expect((await probeSite("https://shop.example.com", loop.fetch)).ok).toBe(false);
  });
  it("fails for 404 and 500 answers and for a site that is down", async () => {
    expect((await probeSite("https://shop.example.com", publicNet({ "shop.example.com": () => new Response("no", { status: 404 }) }).fetch)).ok).toBe(false);
    expect((await probeSite("https://shop.example.com", publicNet({ "shop.example.com": () => new Response("no", { status: 503 }) }).fetch)).ok).toBe(false);
    expect((await probeSite("https://shop.example.com", publicNet({}).fetch)).ok).toBe(false);
  });
  it("never fetches a refused address, and never fetches a name that resolves to a private address", async () => {
    const net = publicNet({ "shop.example.com": ok200 }, { "evil.example.com": ["127.0.0.1"] });
    net.sites["evil.example.com"] = ok200;
    for (const url of ["https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://169.254.169.254", "https://[::1]", "http://shop.example.com", "https://u:p@shop.example.com", "https://evil.example.com"]) {
      expect((await probeSite(url, net.fetch)).ok).toBe(false);
    }
    expect(net.log.filter((l) => !l.url.startsWith("https://cloudflare-dns.com"))).toHaveLength(0);
  });
  it("gives up on a site that never answers", async () => {
    const hang = ((input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(input instanceof Request ? input.url : String(input));
      if (u.hostname === "cloudflare-dns.com") return Promise.resolve(Response.json({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }));
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "TimeoutError"))));
    }) as typeof fetch;
    const r = await probeSite("https://shop.example.com", hang, 50);
    expect(r.ok).toBe(false);
  });
});
