import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";
const API = process.env.E2E_API_URL ?? "https://api-staging.stenmont.com";
const KEY = process.env.STENMONT_E2E_API_KEY;
const BANNED = /\b(gas|wbt|usdt|seed|chain|wallet|crypto|ethereum|token|blockchain|metamask|private key)\b/i;

test.skip(!KEY, "set STENMONT_E2E_API_KEY (a staging merchant key)");

async function newInvoice(request: APIRequestContext, amount = "1.00") {
  const res = await request.post(`${API}/v1/invoices`, {
    headers: { authorization: `Bearer ${KEY}`, "idempotency-key": crypto.randomUUID() },
    data: { amount, metadata: { source: "e2e" } },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}
const invoiceStatus = async (request: APIRequestContext, id: string) =>
  ((await (await request.get(`${API}/v1/invoices/${id}`, { headers: { authorization: `Bearer ${KEY}` } })).json()) as { status: string }).status;

/** Remembers every distinct text the customer sees, so the vocabulary check covers each step, not just the end. */
async function watchVisibleText(page: Page) {
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { __seen: Set<string> }).__seen = seen;
    new MutationObserver(() => document.body && seen.add(document.body.innerText)).observe(document, { subtree: true, childList: true, characterData: true });
  });
  return async () => page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen]);
}

async function virtualAuthenticator(page: Page, verified: boolean) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: verified, automaticPresenceSimulation: true },
  });
}

test("a customer with no wallet pays an invoice with one tap and never sees a crypto word", async ({ page, request }) => {
  const inv = await newInvoice(request);
  await virtualAuthenticator(page, true);
  const seen = await watchVisibleText(page);

  await page.goto(`${APP}/pay/${inv.id}`);
  await expect(page.getByTestId("amount")).toHaveText("$1.00");
  await page.getByRole("button", { name: "Pay $1.00" }).click();
  await expect(page.getByTestId("paid")).toBeVisible({ timeout: 150_000 });

  for (const text of await seen()) expect(text).not.toMatch(BANNED);

  // the backend agrees once the indexer (every minute) has seen the payment
  await expect.poll(() => invoiceStatus(request, inv.id), { timeout: 180_000, intervals: [5_000] }).toBe("paid");
});

test("if the customer cancels the confirmation, nothing is paid and they can try again", async ({ page, request }) => {
  const inv = await newInvoice(request);
  await virtualAuthenticator(page, false); // the device fails to verify the person
  const seen = await watchVisibleText(page);

  await page.goto(`${APP}/pay/${inv.id}`);
  await page.getByRole("button", { name: "Pay $1.00" }).click();
  await expect(page.getByTestId("notice")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Pay $1.00" })).toBeVisible(); // still usable
  for (const text of await seen()) expect(text).not.toMatch(BANNED);
  expect(await invoiceStatus(request, inv.id)).toBe("open");
});

test("an unknown invoice shows a friendly page", async ({ page }) => {
  await page.goto(`${APP}/pay/0x${"0".repeat(64)}`);
  await expect(page.getByRole("heading", { name: /can't be paid/ })).toBeVisible();
});
