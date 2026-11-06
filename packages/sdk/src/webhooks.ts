export type WebhookEvent<T = unknown> = { id: string; type: string; created: number; data: T; livemode: boolean };

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time comparison of two hex strings. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Builds a `Stenmont-Signature` header. Servers use it to sign; you can use it to test your own webhook handler. */
export async function signWebhook(secret: string, body: string, t = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${t},v1=${await hmac(secret, `${t}.${body}`)}`;
}

/**
 * Checks the `Stenmont-Signature` header of a webhook and returns the event. Pass the RAW request body, exactly as
 * received. Throws if the signature is wrong or the timestamp is more than 5 minutes away from now (replay).
 * While a secret is being rotated the header carries two signatures; either one is accepted.
 */
export async function verifyWebhook<T = unknown>(
  body: string,
  header: string,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): Promise<WebhookEvent<T>> {
  const parts = header.split(",").map((p) => p.trim());
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sigs = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) throw new Error("Malformed Stenmont-Signature header");

  const expected = await hmac(secret, `${t}.${body}`);
  if (!sigs.some((s) => same(s, expected))) throw new Error("Invalid webhook signature");

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(t)) > (opts.toleranceSeconds ?? 300)) throw new Error("Webhook timestamp is outside the allowed window");
  return JSON.parse(body) as WebhookEvent<T>;
}
