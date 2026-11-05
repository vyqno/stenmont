import { describe, expect, it } from "vitest";
import { seedMerchant, setup } from "./helpers/app";

const get = (t: ReturnType<typeof setup>, path: string, origin?: string, method = "GET") =>
  t.req(path, { method, headers: origin ? { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } : {} });

describe("CORS: only our own app origin may call the public endpoints from a browser", () => {
  it("allows the app origin on public routes", async () => {
    const t = setup();
    for (const path of ["/pay/0x" + "1".repeat(64), "/l/anything"]) {
      const res = await get(t, path, "https://app.test");
      expect(res.headers.get("access-control-allow-origin")).toBe("https://app.test");
    }
  });
  it("answers the preflight for the relay, with POST and content-type allowed", async () => {
    const t = setup();
    const res = await get(t, "/relay/pay", "https://app.test", "OPTIONS");
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.test");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
  });
  it("gives no CORS headers to other websites", async () => {
    const t = setup();
    const res = await get(t, "/pay/0x" + "1".repeat(64), "https://evil.example");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await get(t, "/relay/pay", "https://evil.example", "OPTIONS");
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("allows localhost development outside production only", async () => {
    const dev = setup();
    expect((await get(dev, "/relay/account", "http://localhost:3000", "OPTIONS")).headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const prod = setup({}, { ENVIRONMENT: "production" });
    expect((await get(prod, "/relay/account", "http://localhost:3000", "OPTIONS")).headers.get("access-control-allow-origin")).toBeNull();
  });
  it("opens the merchant API (/v1) to our own app only, never to other websites", async () => {
    const t = setup();
    const key = await seedMerchant(t.db);
    const own = await t.req("/v1/me", { key, headers: { origin: "https://app.test" } });
    expect(own.headers.get("access-control-allow-origin")).toBe("https://app.test");
    const other = await t.req("/v1/me", { key, headers: { origin: "https://evil.example" } });
    expect(other.status).toBe(200);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
