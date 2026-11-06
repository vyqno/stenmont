type Config = { ENVIRONMENT: string; APP_URL: string; TURNSTILE_SECRET_KEY?: string; TURNSTILE_SITE_KEY?: string };
export function isTurnstileTestKey(key: string) { return /^[123]x0+[A-Z]{2}$/.test(key); }
export async function verifyTurnstile(env: Config, token: string, action: string, net: typeof fetch): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret || !token || token.length > 2048) return false;
  if (env.ENVIRONMENT === "production" && (isTurnstileTestKey(secret) || isTurnstileTestKey(env.TURNSTILE_SITE_KEY ?? "") || token.includes("DUMMY"))) return false;
  try {
    const response = await net("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean; hostname?: string; action?: string };
    // Cloudflare's official dummy response uses example.com and omits action.
    if (env.ENVIRONMENT !== "production" && isTurnstileTestKey(secret) && token === "XXXX.DUMMY.TOKEN.XXXX") return result.success === true && result.hostname === "example.com";
    return result.success === true && result.hostname === new URL(env.APP_URL).hostname && result.action === action;
  } catch { return false; }
}
