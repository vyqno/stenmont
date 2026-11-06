import { resolvesPublic } from "./dns";
import { parseSiteUrl } from "./url";

const MAX_HOPS = 3;

/**
 * Is the site up? One GET. Redirects are followed by hand and only inside the same host over https: anything else is a
 * failure and is never fetched. Every hop passes the same address rules as registration, plus the DNS check.
 */
export async function probeSite(raw: string, f: typeof fetch, timeoutMs = 5_000): Promise<{ ok: boolean; detail: string }> {
  const first = parseSiteUrl(raw);
  if (!first.ok) return { ok: false, detail: first.reason };
  let url = first.url + "/";
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const target = parseSiteUrl(url);
    if (!target.ok) return { ok: false, detail: target.reason };
    if (target.host !== first.host) return { ok: false, detail: `The site redirects to ${target.host}. Register the address it ends on instead.` };
    const dns = await resolvesPublic(target.host, f);
    if (!dns.ok) return { ok: false, detail: dns.reason };
    let res: Response;
    try {
      res = await f(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Stenmont-SiteCheck/1" } });
    } catch {
      return { ok: false, detail: "The site did not answer in time." };
    }
    await res.body?.cancel().catch(() => {});
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, detail: `The site answered ${res.status} with no place to go.` };
      try {
        url = new URL(loc, url).href; // judged at the top of the loop: https, same host, public, or it is never fetched
      } catch {
        return { ok: false, detail: "The site redirects somewhere that is not a web address." };
      }
      continue;
    }
    return res.status < 400 ? { ok: true, detail: `${first.host} answered ${res.status}.` } : { ok: false, detail: `The site answered ${res.status}.` };
  }
  return { ok: false, detail: "The site redirects too many times." };
}
