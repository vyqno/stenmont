import type { Metadata } from "next";
import "@fontsource-variable/onest";
import "@fontsource-variable/geist-mono";
import "./globals.css";

// Neue Haas Grotesk is the brand face once licensed; Onest (self-hosted from npm, so builds need no network) is the open stand-in until then.
export const metadata: Metadata = {
  title: "Stenmont",
  metadataBase: new URL("https://app-staging.stenmont.com"),
  description: "The agentic business kit for invoices, business payments and connected records. Currently on the test network.",
  openGraph: { title: "stenmont", description: "The agentic business kit.", images: [{ url: "/brand/wordmark-social.png", width: 1200, height: 630, alt: "stenmont" }] },
};

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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
