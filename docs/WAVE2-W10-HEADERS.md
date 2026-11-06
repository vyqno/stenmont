# Web response guards

Local implementation verified at 20:12 IST on 2026-11-06. Not yet deployed or browser-verified by this slice.

## Enforcement boundary

Next response rules now send `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and an enforced CSP containing exactly `object-src 'none'; base-uri 'self'; frame-ancestors 'none'`. Current checkout integrations redirect to the pay page; embedding these application pages in another origin is not supported. Outbound World/Turnstile frames are separate and are not blocked by frame-ancestors.

Public marketing/docs use `strict-origin-when-cross-origin`. Account, payment, subscription, certificate, investor, dashboard, consent, sign-in and store route families use `no-referrer` at the HTTP layer. Geolocation and browsing-topics are disabled. Payment, WebAuthn, camera and microphone capabilities are not denied; COOP is not set because wallet/OAuth/World popup compatibility has not been proven.

## Report-only candidate

A separate `Content-Security-Policy-Report-Only` describes candidate default/script/style/font/image/connect/frame/media sources. It permits the existing Adobe kit, Cloudflare Turnstile, World corporate/bridge/simulator hosts and current first-party APIs. Merchant images retain HTTPS flexibility. Next inline scripts/styles still require unsafe-inline in this candidate; a nonce/hash architecture was not introduced.

**This candidate does not block scripts, styles or connections and is not an XSS-prevention claim.** No report collector exists; violations are available in browser developer diagnostics only. Real World, wallet, Turnstile and font flows must be observed before tightening or enforcing it. Runtime host coverage beyond inspected dependencies is unproven.

Header values are fixed constants, never interpolated from request or environment text. Configuration-injection regression inputs containing CRLF and forged CSP text cannot alter the response rules.

## Checks actually run

- Initial new test failed because the header module did not exist. Final targeted `test/securityHeaders.test.ts`: **4 passed**.
- Web `next typegen && tsc --noEmit` passed; changed-file ESLint passed.
- An isolated local Next development server on port3009 returned200 and the expected enforcing/report-only headers on **7/7 routes**: `/`, `/docs`, `/account`, `/pay/header-probe`, `/dashboard`, `/oauth/authorize`, `/invest`. Private referrer overrides were checked from actual HTTP responses, not only the helper output.
- The server stopped and the shared heavy-run lock was released. No second browser or real API action occurred.
- No full workspace suite, production/Cloudflare build, staging deploy, real identity/wallet flow or central CSP report ingestion was run by this slice. The lead owns combined release checks.

## Existing cleanup wiring

Source inspection confirms the isolated install-proof Worker's staging cron already runs every15minutes (`apps/install-proof/wrangler.jsonc`) and its scheduled handler calls the same `cleanupInstallInvoices` path as operator maintenance (`apps/install-proof/src/index.ts`). This slice did not execute a live scheduled event; it does not claim the scheduler is missing.
