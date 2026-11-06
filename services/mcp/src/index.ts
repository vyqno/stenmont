import { Hono } from "hono";

import { createTools, type Api, type McpConfig } from "./capabilities";
export { createTools } from "./capabilities";
const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError } : {}) });

const KEY = /^[A-Za-z0-9_.-]{16,200}$/;
/** What an OAuth-aware client needs to find the sign-in: where the resource document is, and why it was refused. */
const challenge = (origin: string, error?: string) => `Bearer ${error ? `error="${error}", ` : ""}resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
const rpcError = (rid: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: rid ?? null, error: { code, message } });

export function createApp(cfg: McpConfig) {
  const app = new Hono();
  const tools = createTools(cfg);
  app.get("/health", (c) => c.json({ ok: true }));
  const resource = (c: { req: { url: string } }) => ({
    resource: `${new URL(c.req.url).origin}/mcp`,
    authorization_servers: [cfg.apiUrl],
    scopes_supported: ["read", "draft", "write"],
    bearer_methods_supported: ["header"],
  });
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(resource(c)));
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => c.json(resource(c)));
  app.all("/mcp", async (c) => {
    if (c.req.method !== "POST") return c.text("Use POST", 405, { allow: "POST" });
    const key = (c.req.header("authorization") ?? "").replace(/^Bearer /, "").trim();
    const origin = new URL(c.req.url).origin;
    if (!KEY.test(key)) return c.json({ error: "Connect with OAuth, or send your Stenmont API key as 'Authorization: Bearer <key>'." }, 401, { "www-authenticate": challenge(origin) });
    const msg: any = await c.req.json().catch(() => null);
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return c.json(rpcError(null, -32600, "Invalid request"), 400);
    if (msg.id === undefined) return c.body(null, 202); // notification
    // The token goes to the API unchanged; the API decides if it is valid and what it may do.
    let refused = false;
    const api: Api = async (path, init) => {
      const res = await cfg.fetch(cfg.apiUrl + path, { ...init, headers: { ...(init?.headers as object), authorization: `Bearer ${key}` } });
      if (res.status === 401) refused = true;
      return res;
    };
    switch (msg.method) {
      case "initialize":
        return c.json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stenmont", version: "0.1.0" } } });
      case "ping":
        return c.json({ jsonrpc: "2.0", id: msg.id, result: {} });
      case "tools/list":
        return c.json({ jsonrpc: "2.0", id: msg.id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
      case "tools/call": {
        const tool = tools.find((t) => t.name === msg.params?.name);
        if (!tool) return c.json({ jsonrpc: "2.0", id: msg.id, result: text(`Unknown tool: ${String(msg.params?.name)}`, true) });
        const args = tool.schema.safeParse(msg.params?.arguments ?? {});
        if (!args.success) return c.json({ jsonrpc: "2.0", id: msg.id, result: text("Invalid input: " + args.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), true) });
        try {
          const result = await tool.run(args.data, api);
          // An expired or revoked token is an HTTP 401, which is what makes the client refresh it or sign in again.
          if (refused) return c.json({ error: "The access token is expired or was revoked." }, 401, { "www-authenticate": challenge(origin, "invalid_token") });
          return c.json({ jsonrpc: "2.0", id: msg.id, result });
        } catch {
          return c.json({ jsonrpc: "2.0", id: msg.id, result: text("The Stenmont API could not be reached. Try again.", true) });
        }
      }
      default:
        return c.json(rpcError(msg.id, -32601, "Method not found"));
    }
  });
  return app;
}
