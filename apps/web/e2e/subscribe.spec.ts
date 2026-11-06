import { expect, test, type Browser, type Page } from "@playwright/test";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

/** A new business on the subscriptions screen. */
async function business(browser: Browser) {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await virtualAuthenticator(page);
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(`Subs Co ${Date.now()}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("api-key")).toBeVisible({ timeout: 150_000 });
  await page.getByRole("button", { name: "Continue to your dashboard" }).click();
  await page.getByRole("link", { name: "Subscriptions" }).click();
  return page;
}

async function offer(page: Page, max: string) {
  await page.getByLabel("Amount each time (USD)").fill("1.00");
  await page.getByLabel("How often").selectOption("60");
  await page.getByLabel("Most payments").fill(max);
  await page.getByRole("button", { name: "Create subscription" }).click();
  const row = page.getByTestId("subscription-row").first();
  await expect(row).toContainText("offered", { timeout: 60_000 });
  await row.getByRole("button", { name: "Copy link" }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function customerSubscribes(browser: Browser, link: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await virtualAuthenticator(page);
  await page.goto(link);
  await expect(page.getByTestId("schedule")).toContainText("every minute");
  await page.getByRole("button", { name: "Subscribe for $1.00" }).click();
  await expect(page.getByTestId("subscribed")).toBeVisible({ timeout: 150_000 });
  return page;
}

test("a customer subscribes, is charged on schedule until the limit, and the business sees every step", async ({ browser }) => {
  test.setTimeout(540_000);
  const merchant = await business(browser);
  const link = await offer(merchant, "2");
  expect(link).toContain("/subscribe/");
  await customerSubscribes(browser, link);

  const row = merchant.getByTestId("subscription-row").first();
  // the first charge is due at once; the cron (every minute) takes it, then the second a minute later
  await expect(async () => {
    await merchant.reload();
    await expect(row).toContainText("1 of 2 charged", { timeout: 3_000 });
  }).toPass({ timeout: 200_000, intervals: [8_000] });
  await expect(async () => {
    await merchant.reload();
    await expect(row).toContainText("2 of 2 charged", { timeout: 3_000 });
    await expect(row).toContainText("completed");
  }).toPass({ timeout: 240_000, intervals: [8_000] });
});

test("a customer can cancel their subscription with one confirmation", async ({ browser }) => {
  test.setTimeout(420_000);
  const merchant = await business(browser);
  const link = await offer(merchant, "5");
  const customer = await customerSubscribes(browser, link);

  await customer.getByTestId("cancel-subscription").click();
  await expect(customer.getByTestId("cancelled")).toBeVisible({ timeout: 90_000 });

  await merchant.reload();
  await expect(merchant.getByTestId("subscription-row").first()).toContainText("cancelled");
});
