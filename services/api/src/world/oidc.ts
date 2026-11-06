export type OidcFailure = "bad_signature" | "wrong_issuer" | "wrong_audience" | "expired" | "stale_auth" | "nonce_mismatch" | "malformed";
export type OidcClaims = { iss: string; sub: string; aud: string | string[]; exp: number; auth_time: number; nonce: string; [k: string]: unknown };
export type OidcResult = { ok: true; claims: OidcClaims } | { ok: false; reason: OidcFailure };

export type OidcConfig = {
  issuer: string;
  audience: string;
  jwksUrl: string;
  fetch: typeof fetch;
  now: () => Date;
  maxAuthAgeSeconds?: number;
  jwksTtlSeconds?: number;
};

const dec = new TextDecoder();
const b64u = (s: string): Uint8Array<ArrayBuffer> => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p + "=".repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const json = (s: string) => JSON.parse(dec.decode(b64u(s)));
const SKEW = 60;

/** Build once per Worker isolate: it keeps the JWKS cache. An unknown `kid` forces one refetch (at most every 60 s). */
export function createOidcVerifier(cfg: OidcConfig) {
  let keys: any[] = [];
  let fetchedAt = 0;
  const ttl = (cfg.jwksTtlSeconds ?? 600) * 1000;

  async function load(force: boolean): Promise<void> {
    const t = cfg.now().getTime();
    if (fetchedAt && !force && t - fetchedAt < ttl) return;
    if (force && fetchedAt && t - fetchedAt < 60_000) return;
    const res = await cfg.fetch(cfg.jwksUrl);
    if (!res.ok) throw new Error("jwks");
    const body = (await res.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error("jwks");
    keys = body.keys;
    fetchedAt = t;
  }

  async function keyFor(kid: string | undefined): Promise<CryptoKey | null> {
    const find = () => keys.find((k) => k?.kty === "RSA" && (k.use === undefined || k.use === "sig") && (kid === undefined || k.kid === kid));
    await load(false);
    let jwk = find();
    if (!jwk) {
      await load(true);
      jwk = find();
    }
    if (!jwk) return null;
    return crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }

  return async function verifyIdToken(token: string, expected: { nonce: string }): Promise<OidcResult> {
    const fail = (reason: OidcFailure): OidcResult => ({ ok: false, reason });
    const parts = typeof token === "string" ? token.split(".") : [];
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[2]) return fail("malformed");
    let header: any, claims: any;
    try {
      header = json(parts[0]!);
      claims = json(parts[1]!);
    } catch {
      return fail("malformed");
    }
    if (typeof header !== "object" || header === null || typeof claims !== "object" || claims === null) return fail("malformed");
    // Algorithm is pinned: "none", HS256 (public key used as an HMAC secret) and anything else never reach the verifier.
    if (header.alg !== "RS256") return fail("bad_signature");

    let key: CryptoKey | null;
    try {
      key = await keyFor(typeof header.kid === "string" ? header.kid : undefined);
    } catch {
      return fail("bad_signature");
    }
    if (!key) return fail("bad_signature");
    let valid = false;
    try {
      valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    } catch {
      valid = false;
    }
    if (!valid) return fail("bad_signature");

    const now = Math.floor(cfg.now().getTime() / 1000);
    if (claims.iss !== cfg.issuer) return fail("wrong_issuer");
    const aud = claims.aud;
    if (!(aud === cfg.audience || (Array.isArray(aud) && aud.includes(cfg.audience)))) return fail("wrong_audience");
    if (typeof claims.exp !== "number" || claims.exp <= now) return fail("expired");
    if (typeof claims.sub !== "string" || !claims.sub) return fail("malformed");
    if (typeof claims.nonce !== "string" || claims.nonce !== expected.nonce) return fail("nonce_mismatch");
    const age = cfg.maxAuthAgeSeconds ?? 300;
    if (typeof claims.auth_time !== "number" || claims.auth_time > now + SKEW || now - claims.auth_time > age) return fail("stale_auth");
    return { ok: true, claims: claims as OidcClaims };
  };
}
