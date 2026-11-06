import { sitemapEntries, siteConfig } from "../../lib/seo";
export default function sitemap() { return sitemapEntries(siteConfig(), true); }
