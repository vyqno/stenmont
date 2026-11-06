import { expect, test } from "@playwright/test";

const APP = "http://localhost:3006";
test("sample previews support keyboard selection and remain explicitly illustrative", async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === APP ? route.continue() : route.abort());
  await page.goto(APP);
  const tabs = page.getByRole("tablist", { name: "Explore the business kit" });
  await tabs.getByRole("tab", { name: "Get paid" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabs.getByRole("tab", { name: "Books" })).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Books" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Books" })).toContainText("Sample data");
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel", { name: "Agents" })).toContainText("Human approval required");
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: "Sell", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Sell", exact: true })).toContainText("Sample data");
  await page.keyboard.press("ArrowDown");
  const panel = page.getByRole("tabpanel", { name: "Get paid" });
  await panel.getByRole("button", { name: "Investor", exact: true }).click();
  await expect(panel).toContainText("Claims settled");
  await expect(panel).toContainText("Sample data");
  await page.getByRole("tab", { name: "cURL", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "cURL", exact: true })).toContainText("$ORDER_CHECKOUT_KEY");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tabpanel", { name: "Prompt", exact: true })).toContainText("already-funded payer");
});

test("mobile navigation opens with the keyboard and keeps sign-in reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route("**/*", route => new URL(route.request().url()).origin === APP || ["use.typekit.net", "p.typekit.net"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto(APP);
  await page.locator(".mobile-menu summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.locator(".logo").first()).toHaveCSS("font-weight", "400");
  await expect(page.locator(".logo").first()).toHaveCSS("font-size", "20px");
});
