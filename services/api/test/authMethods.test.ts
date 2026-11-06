import { expect, it } from "vitest";
import { setup } from "./helpers/app";

const get = (t: ReturnType<typeof setup>) => t.req("/auth/methods", { headers: { origin: "https://app.test" } });

it("reports only what is configured, with no secrets and a short public cache", async () => {
  const bare = setup({}, { ENVIRONMENT: "staging" });
  const r = await get(bare);
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toBe("public, max-age=60");
  expect(await r.json()).toEqual({ passkey: true, emailCode: false, google: false, wallet: true });

  const full = setup({}, { ENVIRONMENT: "staging", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "fixture-only", EMAIL_CODE_SECRET: "fixture-only", EMAIL_MODE: "live", EMAIL: { send: async () => {} } });
  const body = await (await get(full)).text();
  expect(JSON.parse(body)).toEqual({ passkey: true, emailCode: true, google: true, wallet: true });
  expect(body).not.toContain("fixture-only");
});

it("email codes need a way to deliver them: a secret alone, or sink mode outside tests, is not enough", async () => {
  for (const env of [{ EMAIL_CODE_SECRET: "fixture-only" }, { EMAIL_CODE_SECRET: "fixture-only", EMAIL_MODE: "live" }, { EMAIL_MODE: "live", EMAIL: { send: async () => {} } }]) {
    const t = setup({}, { ENVIRONMENT: "staging", ...env });
    expect(((await (await get(t)).json()) as { emailCode: boolean }).emailCode).toBe(false);
    const start = await t.req("/auth/email/start", { method: "POST", headers: { origin: t.env.APP_URL }, body: JSON.stringify({ email: "a@example.invalid" }) });
    expect(start.status).toBe(501);
    expect(((await start.json()) as any).error).toMatchObject({ code: "email_codes_unavailable", message: "Email codes are not switched on yet." });
  }
});

it("google start is a clean 501 JSON answer, not an outage, when Google is not configured", async () => {
  const t = setup({}, { ENVIRONMENT: "staging" });
  const r = await t.req("/auth/google/start");
  expect(r.status).toBe(501);
  expect(r.headers.get("content-type")).toContain("application/json");
  expect(((await r.json()) as any).error.code).toBe("google_not_configured");
});
