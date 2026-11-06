// Run only after the isolated staging Worker is deployed and the API key is
// injected into this process environment by the owner/secret manager.
import { spawn } from "node:child_process";
// Persisted per installation: reuse this key after timeouts and retries.
const registrationId = "e654772d-acd2-428c-b8d4-e820189a35a9";
const apiKey = process.env.STENMONT_API_KEY;
if (!apiKey) throw new Error("Set STENMONT_API_KEY in the process environment through your secret manager.");
try {
  const response = await fetch("https://api-staging.stenmont.com/v1/webhook-endpoints", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": registrationId },
    body: JSON.stringify({ url: "https://install-proof-staging.stenmont.com/webhooks/stenmont" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("registration failed");
  const result = await response.json();
  if (typeof result.secret !== "string" || !result.secret) throw new Error("secret missing");
  const child = spawn("./node_modules/.bin/wrangler", ["secret", "put", "STENMONT_WEBHOOK_SECRET", "--env", "staging"], { stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.on("error", () => {});
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("secret storage failed")));
  });
  child.stdin.end(result.secret);
  await completion;
  console.log("Webhook registered and signing secret stored in the isolated staging Worker.");
} catch {
  // Never print provider responses, child output, exception objects, or secrets.
  console.error("Webhook setup failed. Check registration/secret settings in the dashboard before retrying; do not expose the response secret.");
  process.exitCode = 1;
}
