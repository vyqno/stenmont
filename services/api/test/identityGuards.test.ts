import { expect, it } from "vitest";
import { verifyTurnstile } from "../src/identity/turnstile";
const dummy = "1x0000000000000000000000000000000AA";
it("production never accepts a Turnstile dummy secret or dummy token", async () => {
  let calls = 0; const f = async () => { calls++; return Response.json({ success: true, hostname: "app.stenmont.com", action: "signup" }); };
  expect(await verifyTurnstile({ ENVIRONMENT: "production", APP_URL: "https://app.stenmont.com", TURNSTILE_SECRET_KEY: dummy }, "good-token", "signup", f as typeof fetch)).toBe(false);
  expect(await verifyTurnstile({ ENVIRONMENT: "production", APP_URL: "https://app.stenmont.com", TURNSTILE_SECRET_KEY: "real-secret" }, "XXXX.DUMMY.TOKEN.XXXX", "signup", f as typeof fetch)).toBe(false);
  expect(calls).toBe(0);
});
it("verifies server-side success, action and hostname; refuses missing or failed tokens", async () => {
  const env = { ENVIRONMENT: "staging", APP_URL: "https://app-staging.stenmont.com", TURNSTILE_SECRET_KEY: dummy };
  const f = async () => Response.json({ success: true, hostname: "app-staging.stenmont.com", action: "signup" });
  expect(await verifyTurnstile(env, "token", "signup", f as typeof fetch)).toBe(true);
  expect(await verifyTurnstile(env, "token", "activate", f as typeof fetch)).toBe(false);
  expect(await verifyTurnstile(env, "", "signup", f as typeof fetch)).toBe(false);
  expect(await verifyTurnstile(env, "token", "signup", (async () => { throw Error(); }) as typeof fetch)).toBe(false);
});
it("handles Cloudflare's documented dummy response only outside production", async () => {
  const response = (async()=>Response.json({success:true,hostname:"example.com"})) as typeof fetch;
  const env={ENVIRONMENT:"staging",APP_URL:"https://app-staging.stenmont.com",TURNSTILE_SECRET_KEY:dummy};
  expect(await verifyTurnstile(env,"XXXX.DUMMY.TOKEN.XXXX","signup",response)).toBe(true);
  expect(await verifyTurnstile({...env,ENVIRONMENT:"production"},"XXXX.DUMMY.TOKEN.XXXX","signup",response)).toBe(false);
});
