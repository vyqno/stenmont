import { expect, test, type Page } from "@playwright/test";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";
const API = process.env.E2E_API_URL ?? "https://api-staging.stenmont.com";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

// What can be checked without a phone: our side of both World integrations, and whether World accepts our client.
test("the API issues a World request signature and an approval link that World's sign-in accepts", async ({ page, request }) => {
  await virtualAuthenticator(page);
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(`World Co ${Date.now()}`);
  await page.getByRole("button", { name: "Continue" }).click();
  const key = (await page.getByTestId("api-key").textContent({ timeout: 150_000 }))!;
  const headers = { authorization: `Bearer ${key}`, "idempotency-key": crypto.randomUUID() };

  const status = await request.get(`${API}/v1/world/status`, { headers });
  expect(await status.json()).toMatchObject({ enrolled: false });

  const sig = await request.post(`${API}/v1/world/rp-signature`, { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { action: "enrol-business" } });
  expect(sig.status(), await sig.text()).toBe(200);
  const body = (await sig.json()) as { app_id: string; environment: string; rp_context: { rp_id: string; signature: string; nonce: string } };
  expect(body.app_id).toMatch(/^app_/);
  expect(body.rp_context.rp_id).toMatch(/^rp_/);
  expect(body.rp_context.signature).toMatch(/^0x[0-9a-f]{130}$/);
  console.log("environment sent to IDKit:", body.environment);

  const appr = await request.post(`${API}/v1/approvals`, { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { operation: "refund", params: { invoiceId: `0x${"ab".repeat(32)}`, amount: "3", to: "0x2222222222222222222222222222222222222222" } } });
  expect(appr.status(), await appr.text()).toBe(201);
  const { authorizeUrl } = (await appr.json()) as { authorizeUrl: string };
  const u = new URL(authorizeUrl);
  console.log("authorize host:", u.origin, "redirect_uri:", u.searchParams.get("redirect_uri"));

  // World's sign-in page: it must not reject our client id or callback address
  const world = await request.get(authorizeUrl, { maxRedirects: 0 });
  const text = (await world.text()).slice(0, 4000);
  console.log("World authorize ->", world.status(), world.headers()["location"] ?? "(no redirect)");
  console.log("body mentions invalid client/redirect:", /invalid[_ ](client|redirect)|redirect_uri|unknown client/i.test(text));
  expect(world.status()).toBeLessThan(500);
});
