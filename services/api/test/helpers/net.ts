/** A fake internet for site checks: DNS-over-HTTPS answers and site responses, with a log of every request made. */
export type FakeNet = {
  fetch: typeof fetch;
  log: { url: string; method: string; redirect?: string; headers: Record<string, string>; body?: string }[];
  txt: Record<string, string[]>;
  a: Record<string, string[]>;
  sites: Record<string, (req: Request) => Response | Promise<Response>>;
};

export function fakeNet(init: Partial<Pick<FakeNet, "txt" | "a" | "sites">> = {}): FakeNet {
  const net: FakeNet = { log: [], txt: {}, a: {}, sites: {}, ...init, fetch: undefined as never };
  net.fetch = (async (input: RequestInfo | URL, opts?: RequestInit) => {
    const req = new Request(input, opts);
    net.log.push({ url: req.url, method: req.method, redirect: opts?.redirect, headers: Object.fromEntries(req.headers), body: opts?.body as string | undefined });
    const u = new URL(req.url);
    if (u.hostname === "cloudflare-dns.com") {
      const name = (u.searchParams.get("name") ?? "").toLowerCase();
      const type = u.searchParams.get("type");
      if (type === "TXT") {
        const recs = net.txt[name];
        return Response.json(recs ? { Status: 0, Answer: recs.map((r) => ({ name, type: 16, TTL: 60, data: `"${r}"` })) } : { Status: 3 });
      }
      const addrs = net.a[name];
      if (type === "A") return Response.json(addrs ? { Status: 0, Answer: addrs.filter((x) => !x.includes(":")).map((x) => ({ name, type: 1, TTL: 60, data: x })) } : { Status: 3 });
      if (type === "AAAA") return Response.json({ Status: 0, Answer: (addrs ?? []).filter((x) => x.includes(":")).map((x) => ({ name, type: 28, TTL: 60, data: x })) });
    }
    const handler = net.sites[u.hostname];
    if (!handler) throw new TypeError("fetch failed");
    return handler(req);
  }) as typeof fetch;
  return net;
}
