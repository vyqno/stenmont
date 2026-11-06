import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { apiBase } from "./pay";

/** The API address for the host a request came to ("app.stenmont.com:443" and "localhost:3000" both work), or null if unknown. */
export function apiBaseForHost(hostHeader: string | null): string | null {
  const host = hostHeader?.split(":")[0]?.toLowerCase();
  if (!host) return null;
  try { return apiBase(host); } catch { return null; }
}

/**
 * Makes an unknown id a real HTTP 404 instead of a friendly page with status 200.
 * Only an explicit "not found" from the API counts; if the API is down or slow the page still renders and says so itself.
 */
export async function notFoundIfMissing(path: string): Promise<void> {
  const base = apiBaseForHost((await headers()).get("host"));
  if (!base) return;
  let status: number | null = null;
  try {
    status = (await fetch(base + path, { cache: "no-store", signal: AbortSignal.timeout(4000) })).status;
  } catch {
    return;
  }
  if (status === 404) notFound();
}
