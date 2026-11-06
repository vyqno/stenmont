import type { Bindings, Deps } from "../src/env";

export function memoryKv() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string, t?: string) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)!) : m.get(k)) : null),
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
    list: async ({ prefix = "", limit = 1000 }: { prefix?: string; limit?: number } = {}) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name })),
      list_complete: true,
    }),
  } as unknown as KVNamespace & { m: Map<string, string> };
}

// Token-shaped test values are assembled at runtime so no vendor-looking literal sits in the repo.
export const fake = (label: string) => ["test", label, "value", "0123456789abcdef"].join("_");

export const SHOP = "demo-shop.myshopify.com";
export const env = (over: Partial<Bindings> = {}): Bindings => ({
  STATE: memoryKv(),
  SHOPIFY_ADMIN_TOKEN: fake("admin"),
  SHOPIFY_WEBHOOK_SECRET: fake("shopify_secret"),
  STENMONT_API_KEY: fake("stenmont_key"),
  STENMONT_WEBHOOK_SECRET: fake("stenmont_whsec"),
  BRIDGE_ADMIN_TOKEN: fake("bridge_admin"),
  SHOPIFY_SHOP_DOMAIN: SHOP,
  STENMONT_API_URL: "https://api.stenmont.test",
  SHOP_URL: "https://shop.example.com",
  ALLOWED_ORIGINS: "https://shop.example.com",
  ...over,
});

export type Call = { url: string; method: string; headers: Headers; body: any; redirect?: RequestRedirect };
export const deps = (fetchImpl: (c: Call) => Response | Promise<Response>, calls: Call[] = []): Deps => ({
  fetch: (async (url: any, init: RequestInit = {}) => {
    const call: Call = { url: String(url), method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body ? safeJson(init.body as string) : undefined, redirect: init.redirect };
    calls.push(call);
    return fetchImpl(call);
  }) as typeof fetch,
  sleep: async () => {},
  now: () => 1_800_000_000_000,
});
const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
