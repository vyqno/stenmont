import { describe, expect, it } from "vitest";
import { apiBaseForHost } from "../lib/serverLookup";

describe("apiBaseForHost", () => {
  it("maps the app hosts to their API, ignoring the port", () => {
    expect(apiBaseForHost("app-staging.stenmont.com")).toBe("https://api-staging.stenmont.com");
    expect(apiBaseForHost("app.stenmont.com:443")).toBe("https://api.stenmont.com");
    expect(apiBaseForHost("localhost:3000")).toBe("http://localhost:8787");
  });
  it("returns null for an unknown or missing host instead of throwing", () => {
    expect(apiBaseForHost("evil.example")).toBeNull();
    expect(apiBaseForHost(null)).toBeNull();
  });
});
