import type { Metadata, MetadataRoute } from "next";

/** No request parameters, customer names or invoice identifiers belong in this inventory. */
export const ROUTES = {
  "/": ["Commerce and finance for stablecoin businesses", "The agentic business kit: storefronts, USDT checkout, books, Capital and scoped agents for stablecoin businesses. Test network only."],
  "/docs": ["Commerce and finance quickstart", "Start selling, connect USDT checkout, reconcile books and explore Capital with scoped agent tools."],
  "/docs/api": ["API reference", "Authentication, invoices, errors and idempotent requests."],
  "/docs/mcp": ["MCP and OAuth", "Connect scoped agents using OAuth with PKCE and draft-only tools."],
  "/docs/sdk": ["SDK and React", "Use the server SDK and a checkout link in React."],
  "/docs/webhooks": ["Webhook reference", "Verify raw-body signatures and fulfil each paid order once."],
  "/docs/x402": ["x402 payments", "Price agent requests and settle authorized test USDT payments."],
  "/docs/faq": ["Frequently asked questions", "Test-network payments, payer funding, agent permissions and records."],
  "/account": ["Your receipts", "View your private payment receipts, refunds and subscription records."],
  "/claim/[id]": ["Receivable certificate", "Check a receivable's recorded status against onchain facts."],
  "/dashboard": ["Business overview", "Review your sales, payments and connected business records."],
  "/dashboard/agent-access": ["Agent access", "Manage discovery skills and connected application access."],
  "/dashboard/agent": ["Finance assistant", "Read business records and review draft proposals under usage limits."],
  "/dashboard/books": ["Books", "Reconcile recorded movements and verify a signed period bundle."],
  "/dashboard/catalog": ["Catalogue", "Manage your business products and variants."],
  "/dashboard/collections": ["Collections", "Review B2B collection drafts and published policy."],
  "/dashboard/connect": ["Connect your site", "Install checkout and review site, domain, webhook and payment checks."],
  "/dashboard/financing": ["Capital", "Review eligible test-network receivables, funding terms and their recorded lifecycle."],
  "/dashboard/identity": ["Business identity", "Manage your ENS business name, team and agent records."],
  "/dashboard/import": ["Import catalogue", "Preview catalogue migration before confirming an import."],
  "/dashboard/invoices": ["Invoices", "Manage your private business invoices and receipts."],
  "/dashboard/settings": ["Business settings", "Manage business access, API keys and connected apps."],
  "/dashboard/subscriptions": ["Subscriptions", "Review recurring agreements and B2B replacement plans."],
  "/dashboard/verification": ["Verification", "Review the facts behind your business verification tier."],
  "/invest": ["Invoices for sale", "Review test-network receivables and their financing terms."],
  "/invest/[invoiceId]": ["Review an investment", "Review a test-network receivable before authorizing funding."],
  "/invest/portfolio": ["Investor portfolio", "Review your private test-network receivable holdings."],
  "/login": ["Sign in", "Sign in to your business using your passkey."],
  "/signup": ["Create your business", "Create a test-network business account with a passkey."],
  "/oauth/authorize": ["Authorize a connection", "Review the business and scopes requested by an application."],
  "/pay/[id]": ["Pay an invoice", "Review and pay an invoice using your own USDT."],
  "/store/[slug]": ["Business storefront", "Browse a business's available catalogue."],
  "/store/[slug]/[handle]": ["Product details", "Review product options before adding an item to your cart."],
  "/store/[slug]/cart": ["Shopping cart", "Review your selection before server-priced checkout."],
  "/subscribe/[id]": ["Review an agreement", "Review a recurring or B2B instalment agreement before signing."],
} as const;
export type RoutePath = keyof typeof ROUTES;
export type SiteConfig = { origin: string; indexPublic: boolean };
const STAGING = "https://app-staging.stenmont.com";
const PUBLIC_ORIGINS = new Set(["https://stenmont.com", "https://app.stenmont.com"]);
export function siteConfig(input: { origin?: string; indexPublic?: string } = {
  origin: process.env.STENMONT_PUBLIC_ORIGIN, indexPublic: process.env.STENMONT_INDEX_PUBLIC_SITE,
}): SiteConfig {
  const origin = input.origin && PUBLIC_ORIGINS.has(input.origin) ? input.origin : STAGING;
  return { origin, indexPublic: origin !== STAGING && input.indexPublic === "yes" };
}
export const publicPaths = Object.keys(ROUTES).filter(p => p === "/" || p === "/docs" || p.startsWith("/docs/")) as RoutePath[];
const privatePrefixes = ["/account", "/claim/", "/dashboard", "/invest", "/login", "/signup", "/oauth/", "/pay/", "/store/", "/subscribe/"];
export function pageMetadata(path: RoutePath, site = siteConfig()): Metadata {
  const [label, description] = ROUTES[path];
  const title = `${label} · stenmont`;
  const isPublic = publicPaths.includes(path);
  const url = isPublic ? `${site.origin}${path === "/" ? "" : path}` : undefined;
  return {
    title, description, metadataBase: new URL(site.origin),
    ...(url ? { alternates: { canonical: url } } : {}),
    robots: { index: isPublic && site.indexPublic, follow: isPublic && site.indexPublic },
    referrer: isPublic ? "strict-origin-when-cross-origin" : "no-referrer",
    openGraph: { title, description, siteName: "stenmont", locale: "en_US", type: "website", ...(url ? { url } : {}), images: [{ url: "/brand/wordmark-social.png", width: 1200, height: 630, alt: "stenmont" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/brand/wordmark-social.png"] },
  };
}
/** Root layout must not pass a home canonical/URL down into private child routes. */
export function baseMetadata(): Metadata {
  const meta = pageMetadata("/");
  delete meta.alternates;
  if (meta.openGraph) delete (meta.openGraph as { url?: unknown }).url;
  return meta;
}
export function sitemapEntries(site = siteConfig(), docsOnly = false): MetadataRoute.Sitemap {
  return publicPaths.filter(p => !docsOnly || p.startsWith("/docs")).map(path => ({ url: `${site.origin}${path === "/" ? "" : path}`, changeFrequency: "weekly", priority: path === "/" ? 1 : path === "/docs" ? 0.9 : 0.7 }));
}
export function robotsPolicy(site = siteConfig()): MetadataRoute.Robots {
  if (!site.indexPublic) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: ["/$", "/docs"], disallow: privatePrefixes }, sitemap: [`${site.origin}/sitemap.xml`, `${site.origin}/docs/sitemap.xml`] };
}
export const safeJsonLd = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
