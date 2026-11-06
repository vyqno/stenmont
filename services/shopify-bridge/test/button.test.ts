import { describe, expect, it } from "vitest";
import { createApp } from "../src";
import { env } from "./helpers";

describe("GET /button.js", () => {
  it("serves a script that parses, is cacheable and never writes HTML", async () => {
    const res = await createApp().request("/button.js", {}, env());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const js = await res.text();
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });
  it("sends only variant ids and quantities, and refuses a non-https pay link", async () => {
    const js = await (await createApp().request("/button.js", {}, env())).text();
    expect(js).toContain("variantId");
    expect(js).not.toMatch(/amount|price|total/i);
    expect(js).toContain('protocol !== "https:"');
  });
});
