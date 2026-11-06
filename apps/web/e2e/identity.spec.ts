import { expect, test } from "@playwright/test";
import { createPublicClient, fallback, http } from "viem";
import { sepolia } from "viem/chains";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";
// Sign-up shows a one-time API key. Never capture that page in traces or failure screenshots.
test.use({ trace: "off", screenshot: "off" });
const reader = createPublicClient({ chain: sepolia, transport: fallback([http("https://sepolia.gateway.tenderly.co"), http("https://ethereum-sepolia-rpc.publicnode.com")]) });

test("Identity dashboard claims, resolves, delegates, locks and revokes a real agent name", async ({ page }, info) => {
  test.setTimeout(600_000);
  expect(APP).toBe("https://app-staging.stenmont.com");
  // This acceptance run never requests payer funding or creates third-party accounts.
  await page.route("**/relay/faucet**", (route) => route.abort());
  const businessName = `Identity ${Date.now()}`;
  console.log(`Isolated staging business requested: ${businessName}`);
  page.on("response", async (response) => {
    if (response.url() === "https://api-staging.stenmont.com/auth/activate" && response.ok()) {
      const result = await response.json();
      console.log(`Created staging business: ${JSON.stringify(result.merchant)}`);
    }
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(businessName);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("api-key")).toBeVisible({ timeout: 150_000 });
  await page.getByRole("button", { name: "Continue to your dashboard" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const account = (await page.getByTestId("account").textContent())!.replace("Account ", "").trim();
  await page.getByRole("link", { name: "Identity", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
  await page.getByLabel("Business label").fill("api");
  await page.getByRole("button", { name: "Check availability" }).click();
  await expect(page.locator("p[role=alert]")).toBeVisible();
  const label = `ui${Date.now().toString(36)}`;
  const name = `${label}.stenmont.eth`;
  console.log(`Business ENS claim requested: ${name}`);
  await page.getByLabel("Business label").fill(label);
  await page.getByRole("button", { name: "Check availability" }).click();
  await expect(page.getByRole("button", { name: "Claim business name" })).toBeEnabled();
  await page.getByRole("button", { name: "Claim business name" }).click();
  await expect(page.getByTestId("business-ens-name")).toHaveText(name, { timeout: 240_000 });
  console.log(`Business ENS claim confirmed: ${name}`);
  await expect.poll(async () => (await reader.getEnsAddress({ name }).catch(() => null))?.toLowerCase(), { timeout: 90_000 }).toBe(account.toLowerCase());
  await expect(page.getByTestId("resolved-address")).toHaveText(account, { ignoreCase: true });
  await page.reload();
  await expect(page.getByTestId("business-ens-name")).toHaveText(name);
  await page.getByLabel("Finance member address").fill("0x7777777777777777777777777777777777777777");
  await page.getByRole("button", { name: "Add finance member" }).click();
  await expect(page.getByRole("status")).toContainText("profile record", { timeout: 150_000 });
  await expect(page.getByRole("button", { name: "Lock payout permanently" })).toBeDisabled();
  await page.getByLabel("I understand this permanently locks the payout and prevents adding more finance members.").check();
  await page.getByRole("button", { name: "Lock payout permanently" }).click();
  await expect(page.getByTestId("payout-state")).toHaveText("Payout permanently locked", { timeout: 150_000 });
  await expect(page.getByRole("button", { name: "Add finance member" })).toBeDisabled();
  await page.getByLabel("Agent label").fill("billing-bot");
  await page.getByLabel("Agent address").fill(account);
  await page.getByLabel("Daily limit (USDT)").fill("101");
  await page.getByRole("button", { name: "Create agent name" }).click();
  await expect(page.getByRole("button", { name: "Request World approval" })).toBeVisible();
  // Do not impersonate a verified human. An above-limit request has created no name.
  expect(await reader.getEnsAddress({ name: `billing-bot.${name}` })).toBeNull();
  await page.getByLabel("Daily limit (USDT)").fill("50");
  await page.getByRole("button", { name: "Create agent name" }).click();
  const row = page.getByTestId("agent-row").filter({ hasText: `billing-bot.${name}` });
  await expect(row).toContainText("active", { timeout: 240_000 });
  await expect.poll(async () => (await reader.getEnsAddress({ name: `billing-bot.${name}` }).catch(() => null))?.toLowerCase(), { timeout: 90_000 }).toBe(account.toLowerCase());
  await page.screenshot({ path: info.outputPath("identity-active.png"), fullPage: true });
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toContainText("revoked", { timeout: 150_000 });
  await expect.poll(async () => await reader.getEnsAddress({ name: `billing-bot.${name}` }).catch(() => "provider error"), { timeout: 90_000 }).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("identity-mobile.png"), fullPage: true });
});
