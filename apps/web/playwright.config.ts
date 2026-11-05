import { defineConfig } from "@playwright/test";

// Runs against a deployed environment (default: staging) because it needs the real API, relayer and chain.
//   STENMONT_E2E_API_KEY=sk_test_... pnpm --filter @stenmont/web e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
