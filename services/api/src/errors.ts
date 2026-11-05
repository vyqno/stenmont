import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const fail = (c: Context, status: ContentfulStatusCode, code: string, message: string, details?: unknown) =>
  c.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
