// Sets a merchant's gas tank (the WBT the relayer may spend on their payments) in a remote D1 database.
//   pnpm --filter @stenmont/scripts fund-gas-tank --merchant m_... --wbt 0.05 [--daily-cap 0.05] [--payer-cap 1000] [--env staging]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseEther } from "viem";
import { toUnits } from "@stenmont/shared";

const { values } = parseArgs({
  options: {
    merchant: { type: "string" },
    wbt: { type: "string" },
    "daily-cap": { type: "string", default: "0.05" },
    "payer-cap": { type: "string", default: "1000" },
    env: { type: "string", default: "staging" },
  },
});
if (!values.merchant || !/^m_[0-9a-f-]{36}$/.test(values.merchant)) throw new Error("--merchant m_<uuid> is required");
if (!values.wbt) throw new Error("--wbt is required (amount of WBT to put in the tank)");
if (values.env === "production") throw new Error("refusing to change production tanks from a script");

const balance = parseEther(values.wbt);
const cap = parseEther(values["daily-cap"]!);
const payerCap = toUnits(values["payer-cap"]!);
const day = new Date().toISOString().slice(0, 10);
const sql =
  `INSERT INTO gas_tanks (merchant_id, wbt_balance, daily_cap_wbt, spent_today_wbt, spent_day, per_payer_daily_cap_usdt, version) ` +
  `VALUES ('${values.merchant}', '${balance}', '${cap}', '0', '${day}', '${payerCap}', 0) ` +
  `ON CONFLICT(merchant_id) DO UPDATE SET wbt_balance = excluded.wbt_balance, daily_cap_wbt = excluded.daily_cap_wbt, ` +
  `per_payer_daily_cap_usdt = excluded.per_payer_daily_cap_usdt, version = gas_tanks.version + 1;`;

execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--env", values.env!, "--command", sql], {
  cwd: join(import.meta.dirname, "..", "services", "api"),
  stdio: ["ignore", "ignore", "inherit"],
});
console.log(`gas tank for ${values.merchant} in ${values.env}: ${values.wbt} WBT, daily cap ${values["daily-cap"]} WBT, per-payer cap ${values["payer-cap"]} USDT`);
