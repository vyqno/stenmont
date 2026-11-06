import { describe, expect, it, vi } from "vitest";
import { setup } from "./helpers/app";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { newD1 } from "./helpers/d1";

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

it('serves static liveness in a secretless local clone without initializing chain credentials', async()=>{
 const chain=vi.fn(()=>{throw Error('Chain credentials are not configured');});
 const app=createApp({chain,now:()=>new Date('2026-11-06T00:00:00Z')});
 const response=await app.request('/health',{}, {ENVIRONMENT:'local',DB:newD1()} as unknown as Env);
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual({ok:true});
 expect(chain).not.toHaveBeenCalled();
});
