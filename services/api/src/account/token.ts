/**
 * A customer's receipts link: a signed, expiring token that names a payer address and a purpose. It is how we show someone their
 * own payments without a login. Format: v1.<address without 0x>.<purpose>.<expiry in unix seconds>.<HMAC-SHA256, base64url>.
 */
export const ACCOUNT_LINK_DAYS = 7;

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const message = (purpose: string, payer: string, exp: string) => enc.encode(`stenmont-account-v1\n${purpose}\n${payer}\n${exp}`);
const key = (secret: string, usage: "sign" | "verify") => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export async function signAccountToken(secret: string, payer: string, purpose: string, now: Date): Promise<string> {
  if (secret.length < 32) throw new Error("account link secret must be at least 32 characters");
  const addr = payer.toLowerCase().replace(/^0x/, "");
  const exp = String(Math.floor(now.getTime() / 1000) + ACCOUNT_LINK_DAYS * 86_400);
  const mac = await crypto.subtle.sign("HMAC", await key(secret, "sign"), message(purpose, addr, exp));
  return `v1.${addr}.${purpose}.${exp}.${b64u(mac)}`;
}

/** The payer (lower-case 0x address) the token is for, or null for anything forged, edited, expired or made for another purpose. Never throws. */
export async function verifyAccountToken(secret: string, token: string, purpose: string, now: Date): Promise<string | null> {
  try {
    if (secret.length < 32 || token.length > 300) return null;
    const [version, addr, p, exp, mac, extra] = token.split(".");
    if (version !== "v1" || extra !== undefined || p !== purpose || !addr || !exp || !mac) return null;
    if (!/^[0-9a-f]{40}$/.test(addr) || !/^\d{1,12}$/.test(exp)) return null;
    const raw = unb64u(mac);
    if (b64u(raw.buffer as ArrayBuffer) !== mac) return null; // one canonical spelling, so a token cannot be re-written to a different string that still verifies
    // HMAC verification in WebCrypto compares in constant time.
    const ok = await crypto.subtle.verify("HMAC", await key(secret, "verify"), raw, message(purpose, addr, exp));
    return ok && Number(exp) * 1000 > now.getTime() ? `0x${addr}` : null;
  } catch {
    return null;
  }
}
