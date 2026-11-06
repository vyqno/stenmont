import { Stenmont } from "@stenmont/sdk";
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

test("a new business uses the SDK to create a checkout, the customer pays and is sent back, and the payment shows in the accountant export", async ({ page }) => {
  await virtualAuthenticator(page);

  // 1. the business signs up and gets its API key
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(`SDK Shop ${Date.now()}`);
  await page.getByRole("button", { name: "Continue" }).click();
  const apiKey = (await page.getByTestId("api-key").textContent({ timeout: 150_000 }))!;

  // 2. the shop's server creates a checkout with the SDK
  const stenmont = new Stenmont({ apiKey, baseUrl: API });
  const session = await stenmont.checkout.sessions.create({ amount: "1.25", successUrl: "https://example.com/thanks?order=1", cancelUrl: "https://example.com/cart" });
  expect(session.url).toContain(`${APP}/pay/`);

  // 3. the customer pays with one tap and is offered the way back to the shop
  await page.goto(session.url);
  await expect(page.getByTestId("cancel-link")).toHaveAttribute("href", "https://example.com/cart");
  await page.getByRole("button", { name: "Pay $1.25" }).click();
  await expect(page.getByTestId("paid")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId("return-link")).toHaveAttribute("href", "https://example.com/thanks?order=1");
  await page.waitForURL(/example\.com\/thanks/, { timeout: 15_000 });

  // 4. the indexer (every minute) marks it paid, and the accountant export lists the payment
  await expect.poll(async () => (await stenmont.invoices.get(session.id)).status, { timeout: 150_000, intervals: [5_000] }).toBe("paid");
  const csv = await stenmont.exports.paymentsCsv({ format: "generic" });
  expect(csv).toContain(",payment,");
  expect(csv).toContain(",1.25,USDT,");
});
