import { Hono } from "hono";
import { formatEther } from "viem";
import { fromUnits } from "@stenmont/shared";
import type { AppEnv } from "../app";
import { DEFAULT_DAILY_GAS_CAP_WEI, DEFAULT_PER_PAYER_DAILY_CAP_USDT, dayOf, loadTank } from "../relayer/caps";

export const gasTankRoutes = new Hono<AppEnv>();

gasTankRoutes.get("/", async (c) => {
  const now = c.var.now();
  const t = await loadTank(c.var.db, c.var.merchantId, now);
  return c.json({
    balance: formatEther(t?.balance ?? 0n),
    dailyCap: formatEther(t?.dailyCap ?? DEFAULT_DAILY_GAS_CAP_WEI),
    spentToday: formatEther(t?.spentToday ?? 0n),
    perPayerDailyCapUsdt: fromUnits(t?.perPayerCap ?? DEFAULT_PER_PAYER_DAILY_CAP_USDT),
    day: dayOf(now),
  });
});
