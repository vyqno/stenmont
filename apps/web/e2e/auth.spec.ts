import { expect, test, type Page } from "@playwright/test";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("a new business signs up with a passkey, signs out, and signs back in without a username", async ({ page }) => {
  const name = `E2E Studio ${Date.now()}`;
  await virtualAuthenticator(page);

  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("api-key")).toHaveText(/^sk_test_[0-9a-f]{32}$/, { timeout: 150_000 });
  await page.getByRole("button", { name: "Continue to your dashboard" }).click();
  await expect(page.getByTestId("business-name")).toHaveText(name);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole("button", { name: "Sign in with your device" }).click();
  await expect(page.getByTestId("business-name")).toHaveText(name, { timeout: 30_000 });
});

test("sign-in without a saved passkey explains what happened and does not sign anyone in", async ({ page }) => {
  await virtualAuthenticator(page); // an authenticator with no credentials
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: "Sign in with your device" }).click();
  await expect(page.getByTestId("notice")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/login$/);
});
