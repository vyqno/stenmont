import { safeJsonLd, siteConfig } from "../lib/seo";

/** Only stable service facts. Never serialize a route's customer or financial data here. */
export function SiteStructuredData() {
  const { origin } = siteConfig();
  const organization = `${origin}/#organization`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": organization, name: "stenmont", url: origin },
      { "@type": "SoftwareApplication", name: "stenmont", url: origin, applicationCategory: "FinanceApplication", operatingSystem: "Web", description: "The agentic business kit for invoices, USDT payments and connected records. Currently on the test network.", publisher: { "@id": organization } },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(graph) }} />;
}
