// Moves a Shopify store into Stenmont: preview first, write only with --confirm.
//   Admin API:  SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com SHOPIFY_ADMIN_TOKEN=... STENMONT_API_KEY=... \
//               pnpm --filter @stenmont/scripts shopify-import --api-url https://api-staging.stenmont.com [--confirm] [--include-customers] [--rate 1.08]
//   CSV files:  STENMONT_API_KEY=... pnpm --filter @stenmont/scripts shopify-import --csv-dir ~/Downloads/shopify --api-url ... --currency USD
// The Shopify token and the Stenmont key come from the environment (the gitignored .env), are sent once, and are never printed or
// written to disk. The report shows counts and warnings only, never customer names, emails, tokens or keys.
import { readFileSync } from "node:fs";
import { buildBody, formatReport, parseConfig, readCsvDir, scrub, UsageError } from "./shopify-import-lib";

async function main() {
  const cfg = parseConfig(process.argv.slice(2), process.env);
  const secrets = [cfg.apiKey, cfg.token];
  const files = cfg.mode === "csv" ? readCsvDir(cfg.csvDir!, cfg.includeCustomers, (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } }) : null;

  async function post(path: string, body: unknown) {
    const res = await fetch(`${cfg.apiUrl}/v1/import/shopify/${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, unknown>;
    if (!res.ok) throw new UsageError(scrub(`${path} failed (${res.status} ${String(json.error?.code ?? "")}): ${String(json.error?.message ?? "no details")}`, secrets));
    return json;
  }

  console.log(`Preview (${cfg.mode === "api" ? cfg.shop : cfg.csvDir}) -> ${cfg.apiUrl}`);
  const preview = (await post("preview", buildBody(cfg, files, false))) as { report: unknown };
  for (const line of formatReport(preview.report)) console.log(line);
  if (!cfg.confirm) {
    console.log("\nNothing was written. Run again with --confirm to import.");
    return;
  }
  const done = (await post("commit", buildBody(cfg, files, true))) as { result?: { created?: number; updated?: number; skipped?: number } };
  const r = done.result ?? {};
  console.log(`\nImported: ${Number(r.created) || 0} new, ${Number(r.updated) || 0} updated, ${Number(r.skipped) || 0} skipped products.`);
}

main().catch((e) => {
  console.error(e instanceof UsageError ? e.message : "The import failed unexpectedly.");
  process.exitCode = 1;
});
