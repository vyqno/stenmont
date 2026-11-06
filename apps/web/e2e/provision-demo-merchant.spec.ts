import { test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

// Not a test: a one-off that signs up a demo business on staging (with a throwaway passkey) and writes its API key to a
// private file. Runs only when PROVISION_KEY_OUT is set.
//   PROVISION_KEY_OUT=/path/key.txt PROVISION_NAME="Studio shop" pnpm exec playwright test e2e/provision-demo-merchant.spec.ts
const out = process.env.PROVISION_KEY_OUT;
test.skip(!out, "set PROVISION_KEY_OUT to run");

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("provision a demo business", async ({ page }) => {
  await virtualAuthenticator(page);
  await page.goto(`${process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com"}/signup`);
  await page.getByLabel("Business name").fill(process.env.PROVISION_NAME ?? "Studio shop");
  await page.getByRole("button", { name: "Continue" }).click();
  const key = (await page.getByTestId("api-key").textContent({ timeout: 150_000 }))!;
  writeFileSync(out!, key, { mode: 0o600 });
});
