import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { Hono } from "hono";
import { requireApiKey } from "./auth";
import { viemChain, type ChainClient } from "./chain";
import type { merchants } from "./db/schema";
import type { Env } from "./env";
import { fail } from "./errors";
import { invoiceRoutes } from "./routes/invoices";
import { linkRoutes } from "./routes/links";
import { publicRoutes } from "./routes/public";
import { webhookEndpointRoutes } from "./routes/webhookEndpoints";

export type Db = DrizzleD1Database;
export type Merchant = typeof merchants.$inferSelect;
export type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; chain: ChainClient; merchantId: string; merchant: Merchant };
};
export type Deps = { chain: (env: Env) => ChainClient };

export function createApp(deps: Deps = { chain: viemChain }) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("db", drizzle(c.env.DB));
    c.set("chain", deps.chain(c.env));
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true }));

  const v1 = new Hono<AppEnv>();
  v1.use("*", requireApiKey);
  v1.get("/me", (c) => c.json({ id: c.var.merchant.id, name: c.var.merchant.name }));
  v1.route("/invoices", invoiceRoutes);
  v1.route("/payment-links", linkRoutes);
  v1.route("/webhook-endpoints", webhookEndpointRoutes);
  app.route("/v1", v1);
  app.route("/", publicRoutes);

  app.notFound((c) => fail(c, 404, "not_found", "Not found"));
  app.onError((e, c) => {
    console.error("unhandled", e);
    return fail(c, 500, "internal", "Internal error");
  });
  return app;
}
