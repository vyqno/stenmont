type Header = { key: string; value: string };
type HeaderRule = { source: string; headers: Header[] };

// These three directives are enforced. Script/style restrictions need browser proof before enforcement.
const ENFORCED_CSP = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const CANDIDATE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://use.typekit.net https://p.typekit.net",
  "font-src 'self' https://use.typekit.net data:",
  // Merchant catalogue images may be hosted on arbitrary HTTPS origins.
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://api-staging.stenmont.com https://api-testnet.stenmont.com https://api.stenmont.com https://bridge.worldcoin.org wss://bridge.worldcoin.org https://*.world.org https://*.worldcoin.org https://challenges.cloudflare.com https://p.typekit.net",
  "frame-src 'self' https://challenges.cloudflare.com https://simulator.worldcoin.org https://*.world.org https://*.worldcoin.org",
  "media-src 'self' https://world-id-assets.com",
  ENFORCED_CSP,
].join("; ");

/** Fixed constants only: no URL, request header or environment text can inject response headers. */
export function securityHeaders(): HeaderRule[] {
  return [
    { source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Browsers ignore this over plain http, so local development is unaffected.
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Do not restrict payment, camera, microphone or WebAuthn capabilities needed by identity/wallet flows.
      { key: "Permissions-Policy", value: "geolocation=(), browsing-topics=()" },
      { key: "Content-Security-Policy", value: ENFORCED_CSP },
      { key: "Content-Security-Policy-Report-Only", value: CANDIDATE_CSP },
    ] },
    ...["/account", "/pay/:path*", "/subscribe/:path*", "/claim/:path*", "/invest/:path*", "/dashboard/:path*", "/oauth/:path*", "/login", "/signup", "/store/:path*"].map(source => ({ source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }] })),
  ];
}
