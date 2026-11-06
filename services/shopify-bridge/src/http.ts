import type { Context } from "hono";
import type { AppEnv } from "./env";
import { BridgeError } from "./util";

export function allowedOrigins(env: { ALLOWED_ORIGINS: string }): string[] {
  return (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter((s) => s && s !== "*");
}

/** Fixed one-minute window per caller address. ponytail: KV counters are not atomic, so this is a brake against floods, not an exact meter. */
export async function rateLimit(c: Context<AppEnv>, name: string, max: number): Promise<void> {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const key = `rl:${name}:${ip}:${Math.floor(c.var.deps.now() / 60_000)}`;
  const n = Number((await c.env.STATE.get(key)) ?? 0);
  if (n >= max) throw new BridgeError(429, "rate_limited", "Too many requests. Try again in a minute.");
  await c.env.STATE.put(key, String(n + 1), { expirationTtl: 120 });
}

export async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (raw.length > 20_000) throw new BridgeError(400, "too_large", "Request body is too large.");
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {}
  throw new BridgeError(400, "bad_json", "Send a JSON object.");
}
