import { turnstileToken } from "./turnstile";
import { apiBase, b64urlDecode, b64urlEncode } from "./pay";

export type Merchant = { id: string; name: string; account: string; credentialId?: string };

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, as: "json" | "text" = "json"): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method === "POST" && path.startsWith("/v1/")) headers["idempotency-key"] = crypto.randomUUID();
  const res = await fetch(apiBase(location.hostname) + path, {
    method,
    credentials: "include", // the session cookie
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  if (res.ok && as === "text") return (await res.text()) as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, unknown>;
  if (!res.ok) throw new AuthError(json.error?.code ?? "error", json.error?.message ?? "Something went wrong. Please try again.", (json.error as { details?: unknown } | undefined)?.details);
  return json as T;
}

const bytes = (b64: string) => b64urlDecode(b64) as BufferSource;
const enc = (b: ArrayBuffer) => b64urlEncode(new Uint8Array(b));

/** Turns the browser's "cancelled" (NotAllowedError) into something a person can read. */
async function ceremony<T>(run: () => Promise<T | null>): Promise<T> {
  try {
    const r = await run();
    if (r) return r;
  } catch (e) {
    if (!(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError"))) throw e;
  }
  throw new AuthError("cancelled", "That was cancelled. Try again when you're ready.");
}

const assertion = (cred: PublicKeyCredential, challengeId: string) => {
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    challengeId,
    credentialId: enc(cred.rawId),
    authenticatorData: enc(r.authenticatorData),
    clientDataJSON: enc(r.clientDataJSON),
    signature: enc(r.signature),
  };
};

type RegisterOptions = {
  challengeId: string;
  options: {
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: PublicKeyCredentialParameters[];
    authenticatorSelection: AuthenticatorSelectionCriteria;
    attestation: AttestationConveyancePreference;
    timeout: number;
  };
};

/**
 * Create a business: a passkey (first prompt), then the same passkey approves setting the account up (second prompt).
 * Resolves with the API key, which the server shows only once.
 */
export async function signUp(businessName: string): Promise<{ apiKey: string; merchant: Merchant }> {
  const reg = await call<RegisterOptions>("POST", "/auth/register/options", { businessName, turnstileToken: await turnstileToken("signup") });
  const o = reg.options;
  const created = await ceremony(
    () =>
      navigator.credentials.create({
        publicKey: { ...o, challenge: bytes(o.challenge), user: { ...o.user, id: bytes(o.user.id) } },
      }) as Promise<PublicKeyCredential | null>,
  );
  const spki = (created.response as AuthenticatorAttestationResponse).getPublicKey();
  if (!spki) throw new AuthError("no_key", "This device could not create a passkey.");
  const done = await call<{ account: string; activation: { challengeId: string; challenge: string } }>("POST", "/auth/register/verify", {
    challengeId: reg.challengeId,
    credentialId: enc(created.rawId),
    publicKey: enc(spki),
    clientDataJSON: enc(created.response.clientDataJSON),
  });

  const approved = await ceremony(
    () =>
      navigator.credentials.get({
        publicKey: {
          challenge: bytes(done.activation.challenge),
          allowCredentials: [{ type: "public-key", id: created.rawId }],
          userVerification: "required",
          rpId: location.hostname,
          timeout: 60_000,
        },
      }) as Promise<PublicKeyCredential | null>,
  );
  const result = await call<{apiKey:string;merchant:Merchant}>("POST", "/auth/activate", { ...assertion(approved, done.activation.challengeId), turnstileToken: await turnstileToken("activate") });
  // Identity linking is explicit in settings; activation always requires this passkey.
  return result;
}

/** Sign in with a saved passkey: no username, no password, no code. */
export async function signIn(): Promise<Merchant> {
  const { challengeId, options } = await call<{ challengeId: string; options: { challenge: string; rpId: string } }>("POST", "/auth/login/options", {});
  const cred = await ceremony(
    () =>
      navigator.credentials.get({
        publicKey: { challenge: bytes(options.challenge), rpId: options.rpId, userVerification: "required", timeout: 60_000 },
      }) as Promise<PublicKeyCredential | null>,
  );
  return (await call<{ merchant: Merchant }>("POST", "/auth/login/verify", assertion(cred, challengeId))).merchant;
}

export const currentMerchant = async (): Promise<Merchant | null> => {
  try {
    const r = await call<{ merchant: Merchant; credentialId: string }>("GET", "/auth/session");
    return { ...r.merchant, credentialId: r.credentialId };
  } catch {
    return null;
  }
};

export const signOut = () => call<void>("POST", "/auth/logout");

/** Calls the merchant API with the signed-in session. Throws AuthError with the server's plain-words message. */
export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  delete: <T>(path: string) => call<T>("DELETE", path),
  text: (path: string) => call<string>("GET", path, undefined, "text"),
};

/** Asks the device to sign a server-made challenge (a refund approval). The same passkey that signed the business up. */
export async function signChallenge(challenge: string, credentialId?: string) {
  const cred = await ceremony(
    () =>
      navigator.credentials.get({
        publicKey: {
          challenge: bytes(challenge),
          rpId: location.hostname,
          userVerification: "required",
          timeout: 60_000,
          ...(credentialId ? { allowCredentials: [{ type: "public-key" as const, id: bytes(credentialId) }] } : {}),
        },
      }) as Promise<PublicKeyCredential | null>,
  );
  const r = cred.response as AuthenticatorAssertionResponse;
  return { credentialId: enc(cred.rawId), authenticatorData: enc(r.authenticatorData), clientDataJSON: enc(r.clientDataJSON), signature: enc(r.signature) };
}
