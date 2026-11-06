import { expect, test } from "@playwright/test";

// LOCAL FIXTURE ONLY. No real accounts, signing, API writes or funding.
const APP = "http://localhost:3006";
test("an unfunded passkey payer stops without requesting faucet funds", async ({ page }) => {
  test.setTimeout(20_000);
  let faucetRequests = 0;
  let accountRequests = 0;
  let paymentRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem("stenmont.passkey.v1", JSON.stringify({
      credentialId: "local-public-fixture", qx: `0x${"1".repeat(64)}`, qy: `0x${"2".repeat(64)}`,
    }));
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === APP) return route.continue();
    if (url.origin !== "http://localhost:8787") return route.abort();
    let body: object;
    if (url.pathname === "/pay/local-unfunded-fixture") {
      body = { id: `0x${"3".repeat(64)}`, number: "LOCAL-FIXTURE", merchantName: "Local fixture business", status: "open", amount: "1", amountPaid: "0", remaining: "1", successUrl: null, cancelUrl: null };
    } else if (url.pathname === "/relay/account") {
      accountRequests++;
      body = { address: `0x${"4".repeat(40)}`, balance: "0" };
    } else if (url.pathname === "/relay/faucet") {
      faucetRequests++;
      return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "faucet_limit" } }) });
    } else {
      paymentRequests++;
      return route.abort();
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": APP, "access-control-allow-credentials": "true" }, body: JSON.stringify(body) });
  });
  await page.goto(`${APP}/pay/local-unfunded-fixture`);
  await page.getByRole("button", { name: "Pay $1.00", exact: true }).click();
  await expect.poll(() => accountRequests).toBe(1);
  await expect(page.getByTestId("notice")).toContainText("You don't have enough funds for this payment.");
  expect(faucetRequests).toBe(0);
  expect(paymentRequests).toBe(0);
  await expect(page.getByText("Where do I get USDT on Whitechain?", { exact: true })).toBeVisible();
});
