import { describe, expect, it } from "vitest";
import { setup } from "./helpers/app";

describe("health", () => {
  it("GET /health returns 200 and {ok:true}", async () => {
    const res = await setup().req("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it("unknown route returns the documented 404 shape", async () => {
    const res = await setup().req("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
  });
});
