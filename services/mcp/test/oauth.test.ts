import { describe, expect, it } from "vitest";
import { createApp } from "../src/index";

const TOKEN = `smt_at_${"a".repeat(64)}`;
type Call = { url: string; auth: string | null };

function setup(respond: (c: Call) => Response = () => Response.json({ data: [] })) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const c = { url, auth: new Headers(init?.headers).get("authorization") };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  const app = createApp({ apiUrl: "https://api.test", appUrl: "https://app.test", fetch: fetchFn });
  const rpc = (method: string, params?: unknown, token: string | null = TOKEN, host = "https://mcp.test") =>
    app.request(`${host}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return { app, calls, rpc };
}

describe("connecting with OAuth", () => {
  it("without credentials answers 401 and tells the client where to learn how to sign in", async () => {
    const { rpc, calls } = setup();
    const res = await rpc("tools/list", undefined, null);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"');
    expect(calls).toHaveLength(0);
  });
  it("publishes the protected resource document naming the Stenmont authorization server", async () => {
    const { app } = setup();
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await app.request(`https://mcp.test${path}`);
      expect(res.status, path).toBe(200);
      expect(await res.json()).toMatchObject({ resource: "https://mcp.test/mcp", authorization_servers: ["https://api.test"], scopes_supported: ["read", "draft", "write"], bearer_methods_supported: ["header"] });
    }
  });
  it("passes an OAuth access token straight through to the API, which does the checking", async () => {
    const { rpc, calls } = setup();
    const res = await rpc("tools/call", { name: "list_invoices", arguments: {} });
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/invoices?limit=25", auth: `Bearer ${TOKEN}` });
  });
  it("answers 401 invalid_token when the API refuses the token, so the client refreshes it", async () => {
    const { rpc } = setup(() => Response.json({ error: { code: "unauthorized", message: "Missing, expired or revoked access token" } }, { status: 401 }));
    const res = await rpc("tools/call", { name: "list_invoices", arguments: {} });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="https://mcp.test/.well-known/oauth-protected-resource"');
  });
  it("tells the agent plainly when the connection lacks the permission for a tool", async () => {
    const { rpc } = setup(() => Response.json({ error: { code: "insufficient_scope", message: 'This needs the "draft" permission' } }, { status: 403 }));
    const body = (await (await rpc("tools/call", { name: "draft_refund", arguments: { invoiceId: `0x${"ab".repeat(32)}` } })).json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('"draft" permission');
    expect(body.result.content[0].text).toMatch(/reconnect/i);
  });
});
