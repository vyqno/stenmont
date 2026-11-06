import { expect, it } from "vitest";
import { apiSecurityHeaders } from "../src/lib/securityHeaders";
import { setup } from "./helpers/app";

it("builds nosniff always and HSTS only for https", () => {
  expect(apiSecurityHeaders(true)).toEqual({ "x-content-type-options": "nosniff", "strict-transport-security": "max-age=31536000; includeSubDomains" });
  expect(apiSecurityHeaders(false)).toEqual({ "x-content-type-options": "nosniff" });
});

it("sends them on success, 404, 401 and preflight responses", async () => {
  const t = setup();
  for (const [path, init] of [["/health", {}], ["/nope", {}], ["/v1/me", {}], ["/auth/methods", { method: "OPTIONS", headers: { origin: "https://app.test", "access-control-request-method": "GET" } }]] as const) {
    const r = await t.app.request(`https://api.test${path}`, init, t.env);
    expect(r.headers.get("x-content-type-options"), path).toBe("nosniff");
    expect(r.headers.get("strict-transport-security"), path).toBe("max-age=31536000; includeSubDomains");
  }
  expect((await t.app.request("http://localhost/health", {}, t.env)).headers.get("strict-transport-security")).toBeNull();
});
