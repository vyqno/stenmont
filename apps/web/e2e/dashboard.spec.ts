import { expect, test, type Page } from "@playwright/test";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("a business creates an invoice, gets paid, refunds with its passkey, and exports for the accountant", async ({ browser }) => {
  test.setTimeout(480_000);
  const merchantCtx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const merchant = await merchantCtx.newPage();
  await virtualAuthenticator(merchant);

  // sign up and land on the dashboard
  await merchant.goto(`${APP}/signup`);
  await merchant.getByLabel("Business name").fill(`Dashboard Co ${Date.now()}`);
  await merchant.getByRole("button", { name: "Continue" }).click();
  await expect(merchant.getByTestId("api-key")).toBeVisible({ timeout: 150_000 });
  await merchant.getByRole("button", { name: "Continue to your dashboard" }).click();
  await expect(merchant.getByRole("heading", { name: "Overview" })).toBeVisible();

  // create an invoice; it appears in the list
  await merchant.getByRole("link", { name: "Invoices" }).click();
  await merchant.getByLabel("Amount (USD)").fill("1.00");
  await merchant.getByLabel("Customer email (optional)").fill("client@example.com");
  await merchant.getByRole("button", { name: "Create invoice" }).click();
  const row = merchant.getByTestId("invoice-row").first();
  await expect(row).toContainText("$1.00", { timeout: 60_000 });
  await expect(row).toContainText("Open");

  // a customer, in their own browser, pays the copied link with one tap
  await row.getByRole("button", { name: "Copy link" }).click();
  const link = await merchant.evaluate(() => navigator.clipboard.readText());
  expect(link).toContain("/pay/");
  const customerCtx = await browser.newContext();
  const customer = await customerCtx.newPage();
  await virtualAuthenticator(customer);
  await customer.goto(link);
  await customer.getByRole("button", { name: "Pay $1.00" }).click();
  await expect(customer.getByTestId("paid")).toBeVisible({ timeout: 150_000 });
  await customerCtx.close();

  // the dashboard shows it paid once the indexer has seen it (runs every minute)
  await expect(async () => {
    await merchant.reload();
    await expect(merchant.getByTestId("invoice-row").first()).toContainText("Paid", { timeout: 5_000 });
  }).toPass({ timeout: 180_000, intervals: [8_000] });

  // refund: the business's passkey approves, the refund is sent
  await merchant.getByTestId("invoice-row").first().getByRole("button", { name: "Refund" }).click();
  await expect(merchant.getByTestId("refund-sent")).toBeVisible({ timeout: 120_000 });
  await expect(async () => {
    await merchant.reload();
    await expect(merchant.getByTestId("invoice-row").first()).toContainText("Refunded", { timeout: 5_000 });
  }).toPass({ timeout: 180_000, intervals: [8_000] });

  // export: payment and refund both listed
  const download = merchant.waitForEvent("download");
  await merchant.getByRole("button", { name: "Export for your accountant" }).click();
  const file = await (await download).createReadStream();
  const csv = await new Promise<string>((resolve) => {
    let s = "";
    file.on("data", (d) => (s += d));
    file.on("end", () => resolve(s));
  });
  expect(csv).toContain(",payment,");
  expect(csv).toContain(",refund,");
  expect(csv).toContain(",-1.00,USDT,");

  // settings: key start, webhooks, the fee money set aside
  await merchant.getByRole("link", { name: "Settings" }).click();
  await expect(merchant.getByTestId("api-keys")).toContainText("sk_test_");
  await expect(merchant.getByText("No webhook endpoints yet.")).toBeVisible();
  await expect(merchant.getByTestId("gas-tank")).toContainText("WBT");

  // overview: nothing left of the $1.00 after the refund
  await merchant.getByRole("link", { name: "Overview" }).click();
  await expect(merchant.getByTestId("stat-received")).toHaveText("$0.00");
});
