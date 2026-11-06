import { describe, expect, it } from "vitest";
import { isPrivateIp, parseSiteUrl } from "../src/sites/url";

describe("parseSiteUrl: SSRF refusals", () => {
  it.each([
    ["localhost", "https://localhost/"],
    ["a localhost subdomain", "https://shop.localhost/"],
    ["localhost with a trailing dot", "https://localhost./"],
    ["IPv4 loopback", "https://127.0.0.1/"],
    ["IPv4 loopback in short form", "https://127.1/"],
    ["IPv4 loopback as a decimal number", "https://2130706433/"],
    ["IPv4 loopback in hex", "https://0x7f000001/"],
    ["10.x", "https://10.0.0.5/"],
    ["172.16.x", "https://172.16.4.4/"],
    ["192.168.x", "https://192.168.1.1/"],
    ["link-local metadata address", "https://169.254.169.254/latest/meta-data"],
    ["a public IPv4 literal (names only)", "https://8.8.8.8/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["IPv6 unique local", "https://[fd00::1]/"],
    ["IPv4-mapped IPv6", "https://[::ffff:127.0.0.1]/"],
    ["plain http", "http://shop.example.com/"],
    ["credentials in the URL", "https://user:pass@shop.example.com/"],
    ["a username only", "https://user@shop.example.com/"],
    ["a non-default port", "https://shop.example.com:8443/"],
    ["a single-label host", "https://intranet/"],
    [".local", "https://printer.local/"],
    [".internal", "https://db.internal/"],
    ["a non-web scheme", "ftp://shop.example.com/"],
    ["javascript:", "javascript:alert(1)"],
    ["not a URL", "shop dot example"],
    ["an empty string", ""],
  ])("refuses %s", (_name, raw) => {
    expect(parseSiteUrl(raw).ok).toBe(false);
  });

  it("accepts a plain https site and normalises it", () => {
    expect(parseSiteUrl("https://Shop.Example.com/#top")).toEqual({ ok: true, url: "https://shop.example.com", host: "shop.example.com" });
    expect(parseSiteUrl("https://shop.example.com/store/?utm=1")).toEqual({ ok: true, url: "https://shop.example.com/store", host: "shop.example.com" });
  });
});

describe("isPrivateIp", () => {
  it.each(["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.1", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1"])("%s is private", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});
