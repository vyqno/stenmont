import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

async function newBusiness(page: Page, name: string) {
  await virtualAuthenticator(page);
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("api-key")).toBeVisible({ timeout: 150_000 });
  await page.getByRole("button", { name: "Continue to your dashboard" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
}

/** Starts the World step and completes it in World's public simulator (the stand-in for World App in staging). */
async function verifyThroughSimulator(page: Page) {
  await page.getByTestId("world-start").click();
  const [sim] = await Promise.all([page.context().waitForEvent("page", { timeout: 30_000 }), page.getByRole("link", { name: "Use the simulator" }).click()]);
  await expect(sim.getByText("Unique Human")).toBeVisible({ timeout: 30_000 }); // the proof our request asks for
  await sim.getByText("Continue", { exact: true }).click({ timeout: 30_000 });
  return sim;
}

test("one person verifies one business: the first can be verified, a second business of the same person is refused", async ({ page, browser }) => {
  test.setTimeout(420_000);
  await newBusiness(page, `World First ${Date.now()}`);
  const sim = await verifyThroughSimulator(page);
  const verified = page.getByText("Verified", { exact: true });
  const refused = page.getByTestId("world-message");
  await expect(verified.or(refused)).toBeVisible({ timeout: 90_000 });
  if (await verified.isVisible()) {
    await page.reload(); // the answer comes from the server, not the page
    await expect(verified).toBeVisible({ timeout: 30_000 });
    test.info().annotations.push({ type: "first business", description: "verified (fresh database)" });
  } else {
    await expect(refused).toContainText("already verified a business");
    test.info().annotations.push({ type: "first business", description: "refused: the simulator person was enrolled by an earlier run" });
  }
  await sim.close();

  // a second business, same person: always refused, and it stays unverified
  const second = await (await browser.newContext()).newPage();
  await newBusiness(second, `World Second ${Date.now()}`);
  const sim2 = await verifyThroughSimulator(second);
  await expect(second.getByTestId("world-message")).toContainText("already verified a business", { timeout: 90_000 });
  await sim2.close();
  await expect(second.getByText("Verified", { exact: true })).toHaveCount(0);
});
