import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { businessTrustData, type BusinessTrustClaims } from "@stenmont/shared";
import type { Hex } from "viem";
import type { AppEnv } from "../app";
import { ensNames, merchants, sites, worldEnrollments } from "../db/schema";
import { lookupTxt } from "../sites/dns";
import { hitRateLimit } from "../relayer/caps";
import { fail } from "../errors";
export const a2aTrustRoutes = new Hono<AppEnv>();
a2aTrustRoutes.get("/a2a/:merchantId/trust", async c => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(c.env.A2A_ATTESTER_PRIVATE_KEY ?? "")) return fail(c, 503, "trust_unavailable", "Fact signing is not configured");
  const mid = c.req.param("merchantId");
  if (!(await hitRateLimit(c.var.db, `a2a:trust:${mid}`, 10, 60, c.var.now()))) return fail(c, 429, "rate_limited", "Try again in a minute");
  const access = await c.env.DB.prepare("SELECT enabled FROM a2a_access WHERE merchant_id=?").bind(mid).first<{ enabled: number }>();
  if (!access?.enabled) return fail(c, 404, "not_found", "Agent discovery unavailable");
  const [merchant] = await c.var.db.select().from(merchants).where(and(eq(merchants.id, mid), eq(merchants.status, "active")));
  const [ens] = await c.var.db.select().from(ensNames).where(and(eq(ensNames.merchantId, mid), eq(ensNames.status, "active")));
  const [world] = await c.var.db.select().from(worldEnrollments).where(and(eq(worldEnrollments.merchantId, mid), eq(worldEnrollments.action, "enrol-business-v2")));
  if (!merchant?.payoutAddress || !ens || !world || !world.proofEnvironment) return fail(c, 409, "facts_incomplete", "Current domain, ENS and World enrollment with recorded proof provenance are all required");
  let resolved: string | null;
  try { resolved = await c.var.ens.resolveAddress(ens.name, { strict: true }); } catch { return fail(c, 503, "ens_unavailable", "ENS observation unavailable"); }
  if (resolved?.toLowerCase() !== merchant.payoutAddress.toLowerCase()) return fail(c, 409, "ens_mismatch", "ENS does not resolve to the current payout");
  const domainSites = await c.var.db.select().from(sites).where(eq(sites.merchantId, mid)).limit(10);
  let domain: string | null = null;
  for (const site of domainSites) {
    const r = await lookupTxt(`_stenmont.${site.host}`, c.var.fetch);
    if (r.ok && r.records.some(v => v.trim() === `stenmont-verify=${site.token}`)) { domain = site.host; break; }
  }
  if (!domain) return fail(c, 409, "domain_unverified", "No current domain control proof");
  const issued = Math.floor(c.var.now().getTime() / 1000);
  const claims: BusinessTrustClaims = { merchantId: mid, environment: `${c.env.ENVIRONMENT}/world:${world.proofEnvironment}`, ensName: ens.name, domain, payout: merchant.payoutAddress, worldVerifiedAt: world.verifiedAt, issuedAt: String(issued), expiresAt: String(issued + 300) };
  const account = privateKeyToAccount(c.env.A2A_ATTESTER_PRIVATE_KEY as Hex);
  const signature = await account.signTypedData(businessTrustData(claims));
  return c.json({ claims, signature, signer: account.address, meaning: "Observed current domain control and ENS payout with a recorded World enrollment. Staging may use the World simulator. Not a safety or KYC guarantee." }, 200, { "cache-control": "no-store" });
});
