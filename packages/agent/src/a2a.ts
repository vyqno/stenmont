import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { parseHttpsUrl } from "@stenmont/shared";
import type { TextReader } from "./resolve";
export const A2A_SKILLS = ["quote", "create_invoice_draft", "check_invoice_status", "get_pay_link", "list_catalogue"] as const;
export type A2ASkill = typeof A2A_SKILLS[number];
const MAX_BYTES = 65_536;
export type AgentCard = { name: string; description: string; version: string; capabilities: Record<string, unknown>; defaultInputModes: string[]; defaultOutputModes: string[]; skills: { id: A2ASkill; name: string; description: string; tags: string[] }[]; supportedInterfaces: { url: string; protocolBinding: "JSONRPC"; protocolVersion: "1.0" }[] };
export type PinnedRequest = (url: URL, options: { addresses: string[]; body?: string; token?: string }) => Promise<{ status: number; body: string; contentType: string; location?: string }>;
export type DiscoveryOptions = { read: TextReader; resolve?: (hostname: string) => Promise<string[]>; /** Trusted transport: MUST connect only to supplied addresses and verify TLS for the original hostname. Never follows redirects. */ request?: PinnedRequest };
export type DiscoveredAgent = { name: string; cardUrl: string; endpoint: string; card: AgentCard };

/** Conservative IPv4-only egress. Unsupported IPv6 fails closed rather than guessing whether it is routable. */
export function isPublicIPv4(ip: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  const p = ip.split(".").map(Number); const [a, b, c] = p as [number, number, number, number];
  if (p.some(n => n > 255)) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2) || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
const safeUrl = (raw: string) => { const s = parseHttpsUrl(raw); if (!s || new URL(raw).hash) throw new Error("unsafe A2A URL"); return new URL(s); };
const resolveDefault = async (host: string) => (await lookup(host, { all: true, verbatim: true })).map(a => a.address);
/** DNS result is pinned at the socket; TLS still validates the original hostname. No second resolver lookup can rebind. */
export const pinnedHttpsRequest: PinnedRequest = (url, options) => new Promise((resolve, reject) => {
  if (!options.addresses.length || !options.addresses.every(isPublicIPv4)) return reject(new Error("unsafe DNS"));
  const req = httpsRequest(url, { method: options.body ? "POST" : "GET", agent: false, servername: url.hostname, family: 4, rejectUnauthorized: true,
    lookup: (_host, _opts, cb) => cb(null, options.addresses[0]!, 4),
    headers: { accept: "application/json", "A2A-Version": "1.0", ...(options.body ? { "content-type": "application/json" } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
  }, res => {
    const chunks: Buffer[] = []; let size = 0;
    res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_BYTES) { res.destroy(); req.destroy(new Error("oversize A2A response")); } else chunks.push(chunk); });
    res.on("error", reject);
    res.on("end", () => resolve({ status: res.statusCode ?? 0, contentType: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString("utf8"), ...(res.headers.location ? { location: res.headers.location } : {}) }));
  });
  const deadline = setTimeout(() => req.destroy(new Error("A2A deadline")), 10_000);
  req.once("close", () => clearTimeout(deadline));
  req.setTimeout(10_000, () => req.destroy(new Error("A2A timeout")));
  req.on("error", reject); if (options.body) req.write(options.body); req.end();
});
async function readJson(url: URL, opts: DiscoveryOptions, body?: string, token?: string): Promise<any> {
  const addresses = await (opts.resolve ?? resolveDefault)(url.hostname);
  if (!addresses.length || !addresses.every(isPublicIPv4)) throw new Error("unsafe DNS answer");
  const r = await (opts.request ?? pinnedHttpsRequest)(url, { addresses, ...(body ? { body } : {}), ...(token ? { token } : {}) });
  if (r.status >= 300 && r.status < 400) throw new Error("A2A redirect refused");
  if (r.status !== 200 || !/^application\/(?:a2a\+)?json(?:;|$)/i.test(r.contentType)) throw new Error("invalid A2A response");
  if (new TextEncoder().encode(r.body).length > MAX_BYTES) throw new Error("oversize A2A response");
  return JSON.parse(r.body);
}
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length < 2048;
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every(text);
export async function discoverAgent(name: string, opts: DiscoveryOptions): Promise<DiscoveredAgent> {
  if (name.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(name)) throw new Error("invalid ENS name");
  const record = await opts.read(name, "stenmont.a2a");
  if (!record) throw new Error("missing stenmont.a2a record");
  const url = safeUrl(record); const card = await readJson(url, opts);
  if (!card || !text(card.name) || !text(card.description) || !text(card.version) || !card.capabilities || typeof card.capabilities !== "object" || Array.isArray(card.capabilities) || !strings(card.defaultInputModes) || !strings(card.defaultOutputModes) || !Array.isArray(card.skills) || card.skills.length > 5 || !card.skills.every((s: any) => A2A_SKILLS.includes(s?.id) && text(s.name) && text(s.description) && strings(s.tags))) throw new Error("invalid agent card schema");
  if (!["streaming", "pushNotifications", "extendedAgentCard"].every(k => card.capabilities[k] === undefined || typeof card.capabilities[k] === "boolean") || !card.defaultInputModes.includes("application/json") || !card.defaultOutputModes.includes("application/json") || new Set(card.skills.map((s: any) => s.id)).size !== card.skills.length) throw new Error("invalid agent capabilities or media types");
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length !== 1) throw new Error("unsupported A2A interfaces");
  const iface = card.supportedInterfaces[0];
  if (iface?.protocolBinding !== "JSONRPC" || iface.protocolVersion !== "1.0") throw new Error("unsupported A2A protocol");
  const endpoint = safeUrl(iface.url);
  if (endpoint.origin !== url.origin) throw new Error("cross-origin A2A endpoint refused");
  return { name, cardUrl: url.href, endpoint: endpoint.href, card };
}
export async function callSkill(agent: DiscoveredAgent, skill: A2ASkill, input: Record<string, unknown>, token: string, opts: DiscoveryOptions): Promise<unknown> {
  if (!A2A_SKILLS.includes(skill) || !agent.card.skills.some(s => s.id === skill)) throw new Error("unadvertised skill");
  const url = safeUrl(agent.endpoint);
  if (url.origin !== safeUrl(agent.cardUrl).origin || /[\r\n]/.test(token) || !token) throw new Error("invalid A2A credentials or endpoint");
  const id = crypto.randomUUID();
  const body = JSON.stringify({ jsonrpc: "2.0", id, method: "SendMessage", params: { message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ data: { skill, input } }] } } });
  if (new TextEncoder().encode(body).length > 16_384) throw new Error("oversize A2A request");
  const r = await readJson(url, opts, body, token);
  if (r?.jsonrpc !== "2.0" || r.id !== id || (!!r.result === !!r.error)) throw new Error("invalid RPC response");
  if (r.error) throw new Error(`A2A RPC error ${Number(r.error.code)}`);
  if (!r.result.task || !text(r.result.task.id) || !/^TASK_STATE_(COMPLETED|INPUT_REQUIRED|FAILED|CANCELED|REJECTED)$/.test(r.result.task.status?.state)) throw new Error("invalid A2A task");
  return r.result.task;
}
