// The pure parts of agent-pays-by-name.ts: read the arguments, resolve a business from its ENS name, pay within limits.
import { DirectoryError, LimitExceeded, agentOptionsFor, createAgentFetch, resolveBusiness, type Business, type TextReader } from "@stenmont/agent";
import type { LocalAccount } from "viem";

export type Args = { name: string; maxPerRequest: string; dailyLimit: string; path: string };

/** `<name.eth> [--max-per-request 0.05] [--daily 1.00] [--path /quote]`. Throws a readable message on anything else. */
export function parseArgs(argv: string[]): Args {
  const out: Args = { name: "", maxPerRequest: "0.05", dailyLimit: "1.00", path: "" };
  const flags: Record<string, "maxPerRequest" | "dailyLimit" | "path"> = { "--max-per-request": "maxPerRequest", "--daily": "dailyLimit", "--path": "path" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const key = flags[a];
    if (key) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      out[key] = v;
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else if (!out.name) out.name = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!out.name) throw new Error("usage: agent-pays-by-name <label.stenmont.eth> [--max-per-request 0.05] [--daily 1.00] [--path /x]");
  for (const k of ["maxPerRequest", "dailyLimit"] as const) if (!/^\d+(\.\d{1,6})?$/.test(out[k])) throw new Error(`${k === "maxPerRequest" ? "--max-per-request" : "--daily"} must be a USDT amount like 0.05`);
  if (out.path && !/^\/[^\s]*$/.test(out.path)) throw new Error("--path must start with / and contain no spaces");
  return out;
}

/** The address to call: the directory's x402 endpoint, plus an optional path that stays on the same host. */
export function targetUrl(b: Business, path: string): string {
  if (!b.x402) throw new DirectoryError("no_x402", `${b.name} publishes no x402 endpoint`);
  if (!path) return b.x402;
  const base = new URL(b.x402);
  const u = new URL(path, base);
  if (u.origin !== base.origin) throw new Error("the path must stay on the business's own host");
  return u.toString();
}

export type PayResult =
  | { ok: true; business: Business; url: string; status: number; body: string; receipt: string | null }
  | { ok: false; business?: Business; stage: "directory" | "limits"; reason: string };

/** Resolves the name, then pays its endpoint within the agent's limits. Nothing is signed until the directory has validated. */
export async function payByName(a: Args, deps: { read: TextReader; account: LocalAccount; fetch?: typeof fetch; now?: () => Date }): Promise<PayResult> {
  let business: Business;
  try {
    business = await resolveBusiness(a.name, deps.read);
  } catch (e) {
    return { ok: false, stage: "directory", reason: e instanceof Error ? e.message : "directory error" };
  }
  try {
    const url = targetUrl(business, a.path);
    const agent = createAgentFetch({ account: deps.account, ...agentOptionsFor(business, a), ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.now ? { now: deps.now } : {}) });
    const res = await agent(url);
    return { ok: true, business, url, status: res.status, body: await res.text(), receipt: res.headers.get("payment-response") };
  } catch (e) {
    if (e instanceof LimitExceeded) return { ok: false, business, stage: "limits", reason: e.message };
    if (e instanceof DirectoryError) return { ok: false, business, stage: "directory", reason: e.message };
    throw e;
  }
}
