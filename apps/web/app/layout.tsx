import type { Metadata } from "next";
import { Geist_Mono, Onest } from "next/font/google";
import "./globals.css";

// Neue Haas Grotesk is the brand face once licensed; Onest (Whitechain's own) is the open stand-in until then.
const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stenmont",
  description: "Cross-border business payments, settled in seconds, with invoices you can finance.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${onest.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Adobe Fonts web project: Neue Haas Grotesk (Text and Display) and All Round Gothic. Domains must be listed in the project. */}
        <link rel="stylesheet" href="https://use.typekit.net/szp4mzp.css" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
