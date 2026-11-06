/** An error that is safe to show a caller: status, a stable code and a message that never contains a secret or upstream text. */
export class BridgeError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const enc = new TextEncoder();

async function sha256(s: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** Constant-time string comparison: both sides are hashed to 32 bytes first, so length does not leak either. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** Shopify signs the RAW body with the app secret and sends the HMAC-SHA256 as base64 in X-Shopify-Hmac-Sha256. */
export async function verifyShopifyHmac(secret: string, rawBody: string, headerB64: string | undefined): Promise<boolean> {
  if (!secret || !headerB64) return false;
  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(atob(headerB64.trim()), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", key, sig, enc.encode(rawBody));
}

/** True when `Authorization: Bearer <token>` matches the expected token. */
export async function bearerOk(header: string | undefined, expected: string): Promise<boolean> {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), expected);
}
