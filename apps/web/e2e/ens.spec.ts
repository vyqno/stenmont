import { expect, test, type Page } from "@playwright/test";
import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const APP = process.env.E2E_APP_URL ?? "https://app-staging.stenmont.com";
const API = process.env.E2E_API_URL ?? "https://api-staging.stenmont.com";
const sepoliaClient = createPublicClient({ chain: sepolia, transport: http(process.env.SEPOLIA_RPC ?? "https://sepolia.gateway.tenderly.co") });

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("a business gets a real ENS name that resolves to its account, adds a finance member, and locks its payout", async ({ page, request }) => {
  test.setTimeout(420_000);
  await virtualAuthenticator(page);
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Business name").fill(`Ens Co ${Date.now()}`);
  await page.getByRole("button", { name: "Continue" }).click();
  const key = (await page.getByTestId("api-key").textContent({ timeout: 150_000 }))!;
  await page.getByRole("button", { name: "Continue to your dashboard" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  const account = (await page.getByTestId("account").textContent())!.replace("Account ", "").trim().toLowerCase();

  const call = (path: string, body: unknown) =>
    request.post(`${API}${path}`, { headers: { authorization: `Bearer ${key}`, "idempotency-key": crypto.randomUUID() }, data: body, timeout: 240_000 });

  // a bad name is refused before anything happens
  expect((await call("/v1/ens/claim-name", { label: "Bad Name" })).status()).toBe(400);

  const label = `e2e${Date.now().toString(36)}`;
  const claim = await call("/v1/ens/claim-name", { label });
  expect(claim.status(), await claim.text()).toBe(201);
  const { name } = (await claim.json()) as { name: string };
  expect(name).toBe(`${label}.stenmont.eth`);

  // the name resolves through the standard ENS path, to the business's own account
  await expect.poll(async () => (await sepoliaClient.getEnsAddress({ name }).catch(() => null))?.toLowerCase(), { timeout: 60_000, intervals: [4_000] }).toBe(account);
  expect((await sepoliaClient.getEnsText({ name, key: "stenmont.payout" }))?.toLowerCase()).toBe(account);

  // a taken label is a clear 409
  expect((await call("/v1/ens/claim-name", { label })).status()).toBe(409);

  // a team member gets the right to edit only the profile record
  const member = "0x7777777777777777777777777777777777777777";
  const grant = await call("/v1/ens/finance", { member });
  expect(grant.status(), await grant.text()).toBe(200);

  // lock the payout for good; afterwards no more members
  const lock = await call("/v1/ens/lock-payout", {});
  expect(lock.status(), await lock.text()).toBe(200);
  expect((await call("/v1/ens/finance", { member })).status()).toBe(409);
  expect((await sepoliaClient.getEnsText({ name, key: "stenmont.payout" }))?.toLowerCase()).toBe(account);

  // an agent is a name under the business: its own identity, policy, expiry, and the right to edit one record
  const agent = privateKeyToAccount(generatePrivateKey()).address;
  const made = await call("/v1/ens/agents", { label: "billing-bot", agentAddress: agent, scopes: ["invoice.read", "refund.draft"], dailyLimit: "50", perTxLimit: "10", expiresInDays: 30, context: "Drafts refunds for the finance team" });
  expect(made.status(), await made.text()).toBe(201);
  const agentName = `billing-bot.${name}`;
  expect(((await made.json()) as { name: string }).name).toBe(agentName);
  await expect.poll(async () => (await sepoliaClient.getEnsAddress({ name: agentName }).catch(() => null))?.toLowerCase(), { timeout: 90_000, intervals: [4_000] }).toBe(agent.toLowerCase());
  expect(await sepoliaClient.getEnsText({ name: agentName, key: "agent-context" })).toBe("Drafts refunds for the finance team");
  expect(JSON.parse((await sepoliaClient.getEnsText({ name: agentName, key: "stenmont.agent.policy" }))!)).toEqual({ dailyLimit: "50", perTxLimit: "10", scopes: ["invoice.read", "refund.draft"] });

  // revoking removes the name
  const gone = await request.delete(`${API}/v1/ens/agents/billing-bot`, { headers: { authorization: `Bearer ${key}` }, timeout: 240_000 });
  expect(gone.status(), await gone.text()).toBe(200);
  await expect.poll(async () => (await sepoliaClient.getEnsAddress({ name: agentName }).catch(() => null)) ?? null, { timeout: 90_000, intervals: [4_000] }).toBeNull();
});
