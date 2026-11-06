import { isPrivateIp } from "./url";

const DOH = "https://cloudflare-dns.com/dns-query";
type Answer = { type: number; data: string };

/** One DNS-over-HTTPS question (Cloudflare 1.1.1.1 JSON). Null when the resolver could not answer, so "no record" and "no answer" differ. */
async function ask(name: string, type: "TXT" | "A" | "AAAA", f: typeof fetch): Promise<Answer[] | null> {
  try {
    const res = await f(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { Status?: number; Answer?: Answer[] };
    if (body.Status === 3) return []; // NXDOMAIN: the name does not exist
    if (body.Status !== 0) return null;
    return body.Answer ?? [];
  } catch {
    return null;
  }
}

/** TXT strings of a name, quotes removed and split strings joined. */
export async function lookupTxt(name: string, f: typeof fetch): Promise<{ ok: true; records: string[] } | { ok: false; reason: string }> {
  const answers = await ask(name, "TXT", f);
  if (!answers) return { ok: false, reason: "The DNS lookup did not work just now. Try again in a minute." };
  const records = answers
    .filter((a) => a.type === 16)
    .map((a) => {
      const parts = [...a.data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!);
      return parts.length ? parts.join("") : a.data;
    });
  return { ok: true, records };
}

/** The name must resolve, and only to public addresses: a public-looking name that points inside a network is refused. */
export async function resolvesPublic(host: string, f: typeof fetch): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [a, aaaa] = await Promise.all([ask(host, "A", f), ask(host, "AAAA", f)]);
  if (!a || !aaaa) return { ok: false, reason: "The DNS lookup did not work just now. Try again in a minute." };
  const ips = [...a, ...aaaa].filter((r) => r.type === 1 || r.type === 28).map((r) => r.data);
  if (ips.length === 0) return { ok: false, reason: `${host} does not resolve to an address.` };
  if (ips.some(isPrivateIp)) return { ok: false, reason: `${host} points to a private network address, so it cannot be checked.` };
  return { ok: true };
}
