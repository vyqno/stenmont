import { expect, test, type Page } from "@playwright/test";

const SHOP = process.env.E2E_SHOP_URL ?? "https://shop-staging.stenmont.com";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("a shopper buys from the example store, pays with one tap, comes back, and the order turns paid by webhook", async ({ page }) => {
  await virtualAuthenticator(page);

  await page.goto(SHOP);
  await page.getByRole("listitem").filter({ hasText: "Desk mug" }).getByRole("button", { name: "Buy" }).click();

  // Stenmont's checkout
  await expect(page).toHaveURL(/app-staging\.stenmont\.com\/pay\//, { timeout: 30_000 });
  await expect(page.getByTestId("amount")).toHaveText("$1.50");
  await page.getByRole("button", { name: "Pay $1.50" }).click();
  await expect(page.getByTestId("paid")).toBeVisible({ timeout: 150_000 });

  // back in the shop (the pay page sends the shopper back by itself)
  await page.waitForURL(/shop-staging\.stenmont\.com\/orders\//, { timeout: 20_000 });
  // the order flips to paid when Stenmont's signed webhook arrives (the indexer runs every minute)
  await expect(page.getByTestId("status")).toHaveText("Paid", { timeout: 180_000 });
});
