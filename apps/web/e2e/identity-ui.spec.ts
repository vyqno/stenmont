import { expect, test } from "@playwright/test";

// Local integration tests deliberately use an isolated API double; live acceptance is identity.spec.ts.
const APP = process.env.IDENTITY_UI_APP_URL ?? "http://127.0.0.1:3100";
const account = "0x7777777777777777777777777777777777777777";
test.use({ trace: "off", screenshot: "off" });
test.skip(!process.env.IDENTITY_UI_APP_URL, "Set IDENTITY_UI_APP_URL to a running local web app for this isolated API-double suite.");

test("claim, resolution failure/retry, permanent-lock confirmation and agent validation", async ({ page }) => {
  let claimed = false;
  let locked = false;
  let resolveDown = true;
  let lockCalls = 0;
  let agentCalls = 0;
  const ownName = () => ({ name: "acme.stenmont.eth", resolver: account, payoutLocked: locked, status: "active" });
  await page.route("**/auth/session", (route) => route.fulfill({ json: { merchant: { id: "identity-local", name: "Acme", account } } }));
  await page.route("**/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const endpoint = url.pathname;
    const ok = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const error = (message: string, status = 502) => ok({ error: { code: status === 404 ? "not_found" : "chain_error", message } }, status);
    if (endpoint === "/v1/ens/name") return claimed ? ok(ownName()) : error("No name", 404);
    if (endpoint === "/v1/ens/agents" && req.method() === "GET") return ok({ data: [] });
    if (endpoint === "/v1/ens/availability") return ok({ label: url.searchParams.get("label"), available: true });
    if (endpoint === "/v1/ens/claim-name") { claimed = true; return ok(ownName(), 201); }
    if (endpoint === "/v1/ens/resolution") {
      if (resolveDown) return error("Resolution is temporarily unavailable.");
      return ok({ name: "acme.stenmont.eth", address: account });
    }
    if (endpoint === "/v1/ens/lock-payout") { lockCalls++; locked = true; return ok(ownName()); }
    if (endpoint === "/v1/ens/agents" && req.method() === "POST") { agentCalls++; return error("Policy requires approval", 409); }
    return error(`Unexpected endpoint ${endpoint}`, 404);
  });
  await page.goto(`${APP}/dashboard/identity`);
  await expect(page.getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
  await page.getByLabel("Business label").fill("acme");
  await page.getByRole("button", { name: "Check availability" }).click();
  await expect(page.getByRole("button", { name: "Claim business name" })).toBeEnabled();
  await page.getByLabel("Business label").fill("changed");
  await expect(page.getByRole("button", { name: "Claim business name" })).toBeDisabled();
  await page.getByLabel("Business label").fill("acme");
  await page.getByRole("button", { name: "Check availability" }).click();
  await page.getByRole("button", { name: "Claim business name" }).click();
  await expect(page.getByTestId("business-ens-name")).toHaveText("acme.stenmont.eth");
  await expect(page.getByText("Resolution is temporarily unavailable.")).toBeVisible();
  resolveDown = false;
  await page.getByRole("button", { name: "Refresh identity" }).click();
  await expect(page.getByTestId("resolved-address")).toHaveText(account);
  await expect(page.getByRole("button", { name: "Lock payout permanently" })).toBeDisabled();
  expect(lockCalls).toBe(0);
  await page.getByLabel("I understand this permanently locks the payout and prevents adding more finance members.").check();
  await page.getByRole("button", { name: "Lock payout permanently" }).click();
  await expect(page.getByTestId("payout-state")).toHaveText("Payout permanently locked");
  expect(lockCalls).toBe(1);
  await expect(page.getByRole("button", { name: "Add finance member" })).toBeDisabled();
  await page.getByLabel("Agent label").fill("billing-bot");
  await page.getByLabel("Agent address").fill(account);
  await page.getByLabel("Daily limit (USDT)").fill("1");
  await page.getByLabel("Per-payment limit (USDT)").fill("10");
  await page.getByRole("button", { name: "Create agent name" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Check the agent" })).toContainText("Check the agent");
  expect(agentCalls).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
