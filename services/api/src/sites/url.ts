/**
 * The only way a merchant-supplied address becomes something the server fetches. Names only (no IP literals), https on the
 * default port, no credentials, no names that only mean something on a private network. A name can still point at a private
 * address, so `resolvesPublic` (dns.ts) is checked before every fetch.
 */
export type SiteUrl = { ok: true; url: string; host: string } | { ok: false; reason: string };

const PRIVATE_SUFFIXES = ["localhost", "local", "internal", "localdomain", "lan", "home", "home.arpa", "corp", "intranet"];

export function parseSiteUrl(raw: string): SiteUrl {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "That is not a web address." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "The address must start with https://" };
  if (u.username || u.password) return { ok: false, reason: "The address must not contain a username or password." };
  if (u.port) return { ok: false, reason: "Use the standard https port (no :port in the address)." };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) return { ok: false, reason: "Use your site's name, not an IP address." };
  const labels = host.split(".");
  const last = labels[labels.length - 1]!;
  if (host.length > 253 || labels.length < 2 || !labels.every((l) => /^[a-z0-9-]{1,63}$/.test(l))) return { ok: false, reason: "That is not a public site name." };
  if (/^\d+$/.test(last)) return { ok: false, reason: "Use your site's name, not an IP address." };
  if (PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) return { ok: false, reason: "That name is only reachable on a private network." };
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `https://${host}${path}`, host };
}

/** True for addresses that are not on the public internet. Takes the text form of an IPv4 or IPv6 address. */
export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = (addr: string) => {
    const p = addr.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // not an address we understand: refuse
    const [a, b] = [p[0]!, p[1]!];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  };
  if (!s.includes(":")) return v4(s);
  const mappedDotted = /^(?:0:0:0:0:0:|::)ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mappedDotted) return v4(mappedDotted[1]!);
  const mappedHex = /^(?:0:0:0:0:0:|::)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1]!, 16);
    const lo = parseInt(mappedHex[2]!, 16);
    return v4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(s.split(":")[0] || "0", 16);
  return first === 0 || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}
