import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isAppOrigin, requireAuth } from "./auth";
import { viemChain, type ChainClient } from "./chain";
import type { merchants } from "./db/schema";
import type { Env } from "./env";
import { viemEns, type EnsClient } from "./ens/client";
import { ensRoutes } from "./routes/ens";
import { fail } from "./errors";
import { apiKeyRoutes } from "./routes/apiKeys";
import { authRoutes } from "./routes/auth";
import { exportRoutes } from "./routes/exports";
import { financingRoutes } from "./routes/financing";
import { investRoutes } from "./routes/invest";
import { invoiceRoutes } from "./routes/invoices";
import { oauthGrantRoutes, oauthRoutes } from "./routes/oauth";
import { gasTankRoutes } from "./routes/gasTank";
import { linkRoutes } from "./routes/links";
import { publicRoutes } from "./routes/public";
import { refundRoutes } from "./routes/refunds";
import { relayRoutes } from "./routes/relay";
import { subscriptionPublicRoutes, subscriptionRelayRoutes, subscriptionRoutes } from "./routes/subscriptions";
import { approvalRoutes, worldAuthRoutes, worldRoutes } from "./routes/world";
import { webhookEndpointRoutes } from "./routes/webhookEndpoints";

const USER_AGENT = "stenmont-api/1.0 (+https://stenmont.com)";
function withUserAgent(h?: HeadersInit): Headers {
  const headers = new Headers(h);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
  return headers;
}

export type Db = DrizzleD1Database;
export type Merchant = typeof merchants.$inferSelect;
export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; chain: ChainClient; ens: EnsClient; fetch: typeof fetch; now: () => Date; merchantId: string; merchant: Merchant };
};
export type Deps = { chain: (env: Env) => ChainClient; ens?: (env: Env) => EnsClient; now: () => Date; /** For outbound calls to World; tests pass a fake. */ fetch?: typeof fetch };

export function createApp(deps: Deps = { chain: viemChain, now: () => new Date() }) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("db", drizzle(c.env.DB));
    c.set("chain", deps.chain(c.env));
    c.set("ens", (deps.ens ?? viemEns)(c.env));
    c.set("now", deps.now);
    // Outbound calls (World's verifier and sign-in) identify themselves; services behind bot protection refuse anonymous requests.
    c.set("fetch", deps.fetch ?? ((input, init) => fetch(input, { ...init, headers: withUserAgent(init?.headers) })));
    await next();
  });

  // Browsers may call only the public endpoints, and only from our own app (or localhost outside production).
  const origin = (o: string, c: { env: Env }) => (isAppOrigin(o, c.env) ? o : null);
  const publicCors = cors({ origin, allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 600 });
  // The sign-in and merchant API are for our own app only, and may carry the session cookie.
  const appCors = cors({
    origin,
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "idempotency-key"],
    maxAge: 600,
  });
  app.use("/auth/*", appCors);
  app.use("/v1/*", appCors);
  app.use("/pay/*", publicCors);
  app.use("/l/*", publicCors);
  app.use("/relay/*", publicCors);
  app.use("/invest/*", publicCors);

  app.get("/health", (c) => c.json({ ok: true }));

  const v1 = new Hono<AppEnv>();
  v1.use("*", requireAuth);
  v1.get("/me", (c) => c.json({ id: c.var.merchant.id, name: c.var.merchant.name }));
  v1.route("/invoices", invoiceRoutes);
  v1.route("/payment-links", linkRoutes);
  v1.route("/webhook-endpoints", webhookEndpointRoutes);
  v1.route("/gas-tank", gasTankRoutes);
  v1.route("/exports", exportRoutes);
  v1.route("/api-keys", apiKeyRoutes);
  v1.route("/refunds", refundRoutes);
  v1.route("/subscriptions", subscriptionRoutes);
  v1.route("/ens", ensRoutes);
  v1.route("/world", worldRoutes);
  v1.route("/approvals", approvalRoutes);
  v1.route("/financing", financingRoutes);
  v1.route("/oauth", oauthGrantRoutes);
  app.route("/v1", v1);
  app.route("/", oauthRoutes);
  app.route("/auth/world", worldAuthRoutes);
  app.route("/auth", authRoutes);
  app.route("/invest", investRoutes);
  app.route("/relay", relayRoutes);
  app.route("/relay", subscriptionRelayRoutes);
  app.route("/", subscriptionPublicRoutes);
  app.route("/", publicRoutes);

  app.notFound((c) => fail(c, 404, "not_found", "Not found"));
  app.onError((e, c) => {
    console.error("unhandled", e);
    return fail(c, 500, "internal", "Internal error");
  });
  return app;
}
