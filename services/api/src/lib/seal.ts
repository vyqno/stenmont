/**
 * Seals a short secret (a Shopify access token) for storage: AES-GCM with a key derived from a server secret by HKDF,
 * a random 12-byte nonce per call, and the owner (merchant id, shop) bound in as authenticated data, so a sealed value
 * copied to another row or another business does not open. Output is base64url(nonce + ciphertext).
 */
const enc = new TextEncoder();
const PURPOSE = "stenmont/shopify-token/v1";

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const fromB64 = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

async function aesKey(secret: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("stenmont/seal"), info: enc.encode(PURPOSE) }, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const aad = (parts: string[]) => enc.encode(parts.join("\u0000"));

export async function seal(secret: string, plaintext: string, bind: string[]): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(bind) }, await aesKey(secret), enc.encode(plaintext)));
  return toB64(new Uint8Array([...iv, ...ct]));
}

/** The plaintext, or null for anything that does not open (wrong secret, wrong owner, tampered, malformed). */
export async function unseal(secret: string, sealed: string, bind: string[]): Promise<string | null> {
  try {
    const raw = fromB64(sealed);
    if (raw.length < 12 + 16) return null;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: aad(bind) }, await aesKey(secret), raw.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
