import type { Metadata } from "next";
import "@fontsource-variable/onest";
import "@fontsource-variable/geist-mono";
import "./globals.css";

// Neue Haas Grotesk is the brand face once licensed; Onest (self-hosted from npm, so builds need no network) is the open stand-in until then.
export const metadata: Metadata = {
  title: "Stenmont",
  description: "Cross-border business payments, settled in seconds, with invoices you can finance.",
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
