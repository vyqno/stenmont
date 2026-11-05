// Creates a merchant and an API key in a remote D1 database (staging by default). Prints the key ONCE to the
// file given by --key-out (or stdout). The key is stored only as a SHA-256 hash.
//   pnpm --filter @stenmont/scripts create-merchant --name "Acme" --address 0x... [--payout 0x...] [--env staging] [--key-out path]
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    address: { type: "string" },
    payout: { type: "string" },
    env: { type: "string", default: "staging" },
    "key-out": { type: "string" },
  },
});
const need = (v: string | undefined, n: string) => {
  if (!v) throw new Error(`--${n} is required`);
  return v;
};
const name = need(values.name, "name");
const address = need(values.address, "address");
const payout = values.payout ?? address;
for (const a of [address, payout]) if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error(`not an address: ${a}`);
if (!/^[\w .&'-]{1,80}$/.test(name)) throw new Error("name: letters, numbers, spaces and . & ' - only");
const env = values.env!;
if (env === "production") throw new Error("refusing to create merchants in production from a script");

const id = `m_${randomUUID()}`;
const key = `sk_test_${randomBytes(16).toString("hex")}`;
const now = new Date().toISOString();
const hash = createHash("sha256").update(key).digest("hex");
const sql =
  `INSERT INTO merchants (id, name, address, payout_address, created_at) VALUES ('${id}', '${name.replaceAll("'", "''")}', '${address}', '${payout}', '${now}');` +
  `INSERT INTO api_keys (id, merchant_id, prefix, hash, scopes, created_at) VALUES ('k_${randomUUID()}', '${id}', '${key.slice(8, 16)}', '${hash}', '*', '${now}');`;

execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--env", env, "--command", sql], {
  cwd: join(import.meta.dirname, "..", "services", "api"),
  stdio: ["ignore", "ignore", "inherit"],
});

if (values["key-out"]) {
  writeFileSync(values["key-out"], key, { mode: 0o600 });
  console.log(`merchant ${id} created in ${env}; API key written to ${values["key-out"]}`);
} else {
  console.log(`merchant ${id} created in ${env}\nAPI key (shown once): ${key}`);
}
