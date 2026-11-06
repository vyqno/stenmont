import type { Context } from "hono";
import { z } from "zod";
import { toUnits } from "@stenmont/shared";
import { fail } from "../errors";

export const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "must be a decimal with at most 6 places")
  .refine((v) => {
    try {
      return toUnits(v) > 0n; // zod still runs refinements after the regex fails, and toUnits throws on bad input
    } catch {
      return false;
    }
  }, "must be greater than zero");

export const idSchema = z.string().regex(/^0x[0-9a-f]{64}$/);

export function invalid(c: Context, error: z.ZodError) {
  return fail(c, 400, "invalid_request", "Request validation failed", error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

/** https only, and never a loopback, private or link-local host: webhooks must not reach our own network. */
export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (h.startsWith("[")) return false; // no IPv6 literals
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

/** Where a customer may be sent after checkout: a public https address, or http://localhost outside production. */
export function returnUrlOk(raw: string, environment: string): boolean {
  if (isPublicHttpsUrl(raw)) return true;
  return environment !== "production" && /^http:\/\/localhost:\d+(\/|$)/.test(raw) && URL.canParse(raw);
}
