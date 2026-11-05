import { Hono } from "hono";

export type Env = { DB: D1Database };

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

export default app;
