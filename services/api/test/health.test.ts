import { describe, expect, it } from "vitest";
import app from "../src/index";

describe("health", () => {
  it("GET /health returns 200 and {ok:true}", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it("unknown route returns 404 json", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});
