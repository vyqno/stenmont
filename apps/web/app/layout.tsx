import { SiteStructuredData } from "../components/SiteStructuredData";
import { baseMetadata } from "../lib/seo";
import "@fontsource-variable/onest";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import "./brand-v2.css";
import Motion from "../components/Motion";

// Neue Haas Grotesk is the brand face once licensed; Onest (self-hosted from npm, so builds need no network) is the open stand-in until then.
export const metadata = baseMetadata();

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <head>
        {/* Adobe Fonts web project: Neue Haas Grotesk (Text and Display) and All Round Gothic. Domains must be listed in the project. */}
        <link rel="stylesheet" href="https://use.typekit.net/szp4mzp.css" />
      </head>
      <body className="min-h-full flex flex-col"><SiteStructuredData /><Motion />{children}</body>
    </html>
  );
}
