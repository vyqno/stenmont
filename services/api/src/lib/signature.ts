import { hmacSha256Hex, timingSafeEqual } from "./crypto";

/** Header value for `Stenmont-Signature`: `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export async function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${body}`)}`;
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string,
  opts: { now?: number; toleranceSeconds?: number } = {},
): Promise<boolean> {
  const t = /(?:^|,)t=(\d+)(?:,|$)/.exec(header)?.[1];
  const v1 = /(?:^|,)v1=([0-9a-f]{64})(?:,|$)/.exec(header)?.[1];
  if (!t || !v1) return false;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > (opts.toleranceSeconds ?? 300)) return false;
  return timingSafeEqual(v1, await hmacSha256Hex(secret, `${t}.${body}`));
}
