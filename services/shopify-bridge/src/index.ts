import { Hono } from "hono";
import type { AppEnv, Deps } from "./env";
import { allowedOrigins, jsonBody, rateLimit } from "./http";
import { invoiceForDraft, shopifyFor } from "./invoices";
import { receiveStenmont } from "./stenmontWebhook";
import { createDraft, parseCartLines, sendDraftInvoice } from "./ops";
import { numericId, toGid } from "./shopify";
import { BridgeError, bearerOk } from "./util";

const defaultDeps: Deps = { fetch: (...a) => fetch(...a), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() };

export function createApp(overrides: Partial<Deps> = {}) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("deps", { ...defaultDeps, ...overrides });
    await next();
  });

  app.onError((e, c) => {
    if (e instanceof BridgeError) return c.json({ error: { code: e.code, message: e.message } }, e.status);
    console.error("unhandled", e instanceof Error ? e.name : "unknown"); // never the message: it could carry request data
    return c.json({ error: { code: "internal_error", message: "Something went wrong." } }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // The storefront calls this from the browser, so only the shop's own origins may (CORS), and it is rate limited.
  app.use("/checkout", async (c, next) => {
    const origin = c.req.header("origin");
    const allowed = origin !== undefined && allowedOrigins(c.env).includes(origin);
    if (origin !== undefined && !allowed) throw new BridgeError(403, "origin_not_allowed", "This origin may not use the bridge.");
    if (allowed) {
      c.header("access-control-allow-origin", origin);
      c.header("vary", "origin");
    }
    if (c.req.method === "OPTIONS") {
      c.header("access-control-allow-methods", "POST, OPTIONS");
      c.header("access-control-allow-headers", "content-type");
      c.header("access-control-max-age", "600");
      return c.body(null, 204);
    }
    await next();
  });

  app.post("/checkout", async (c) => {
    await rateLimit(c, "checkout", 20);
    const body = await jsonBody(c);
    const shopify = shopifyFor(c.env, c.var.deps);
    const draftGid = body.draftOrderId !== undefined ? toGid("DraftOrder", body.draftOrderId) : await createDraft(shopify, parseCartLines(body.cartLines));
    const { record } = await invoiceForDraft(c.env, c.var.deps, shopify, draftGid);
    return c.json({ payUrl: record.payUrl, invoiceId: record.invoiceId, draftOrderId: numericId(draftGid) });
  });

  // Sends email on the merchant's behalf, so it needs the admin bearer.
  app.post("/invoice-send", async (c) => {
    await rateLimit(c, "invoice-send", 10);
    if (!(await bearerOk(c.req.header("authorization"), c.env.BRIDGE_ADMIN_TOKEN))) throw new BridgeError(401, "unauthorized", "Missing or wrong bearer token.");
    const body = await jsonBody(c);
    const message = body.message === undefined ? "Pay this invoice with USDT (Stenmont):" : body.message;
    if (typeof message !== "string" || message.length > 1000) throw new BridgeError(422, "bad_message", "message must be text of at most 1000 characters.");
    const shopify = shopifyFor(c.env, c.var.deps);
    const { record } = await invoiceForDraft(c.env, c.var.deps, shopify, toGid("DraftOrder", body.draftOrderId));
    await sendDraftInvoice(shopify, toGid("DraftOrder", body.draftOrderId), `${message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")}\n${record.payUrl}`);
    return c.json({ sent: true, payUrl: record.payUrl, invoiceId: record.invoiceId });
  });

  // Stenmont tells us a payment happened. The raw body is verified before anything is parsed.
  app.post("/webhooks/stenmont", async (c) => {
    const result = await receiveStenmont(c.env, c.var.deps, await c.req.text(), c.req.header("stenmont-signature"));
    return c.json(result);
  });

  return app;
}

export default createApp();
