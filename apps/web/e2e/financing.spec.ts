import { expect, test, type Page } from "@playwright/test";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

async function signUpWithInvoice(page: Page) {
  await virtualAuthenticator(page);
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(`Finance Co ${Date.now()}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("api-key")).toBeVisible({ timeout: 150_000 });
  await page.getByRole("button", { name: "Continue to your dashboard" }).click();
  await page.getByRole("link", { name: "Invoices" }).click();
  const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Amount (USD)").fill("100.00");
  await page.getByLabel("Due date (optional)").fill(due);
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByTestId("invoice-row").first()).toContainText("$100.00", { timeout: 60_000 });
}

test("a business that is not verified is pointed to Verify your business when it tries to sell an invoice", async ({ page }) => {
  test.setTimeout(240_000);
  await signUpWithInvoice(page);
  await page.getByTestId("sell-open").first().click();
  // 3% discount and 10% held back on $100.00: cash today is $87.00
  await expect(page.getByTestId("sell-advance")).toHaveText("$87.00");
  await page.getByTestId("sell-submit").click();
  await expect(page.getByTestId("sell-error")).toContainText("Verify your business");
  await expect(page.getByRole("link", { name: /Verify your business/ })).toBeVisible();
});

test.skip("a verified business lists an invoice and it appears on the public market", async () => {
  // Needs a business that completed World ID verification ("enrol-business"). World cannot be completed headless, so this
  // is run by hand: verify the business in Settings, then sell the invoice (two passkey prompts), then check /invest.
});

test("the public market page renders (list or empty state) without logging in", async ({ page }) => {
  await page.goto(`${APP}/invest`);
  await expect(page.getByRole("heading", { name: "Invoices for sale" })).toBeVisible();
  await expect(page.getByTestId("market-empty").or(page.getByTestId("claim-row").first())).toBeVisible({ timeout: 30_000 });
});

test("a fresh investor sees the verification step and cannot buy until verified", async ({ page }) => {
  test.setTimeout(120_000);
  await virtualAuthenticator(page);
  await page.goto(`${APP}/invest`);
  const row = page.getByTestId("claim-row").first();
  test.skip(!(await row.isVisible({ timeout: 30_000 }).catch(() => false)), "needs at least one invoice on the market");
  await row.click();
  await expect(page.getByTestId("risk-note")).toBeVisible();
  await expect(page.getByTestId("fund-button")).toBeDisabled();
  await page.getByTestId("invest-start").click();
  await expect(page.getByTestId("verify-start")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("fund-button")).toBeDisabled();
});
