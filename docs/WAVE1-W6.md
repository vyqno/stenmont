# Wave 1 · W6 brand and docs migration

## 2026-11-06 · 17:49 IST

Implemented in an isolated clone from `08272b6`. No deploy, push, live account creation, emails, transactions or external writes. `docs/TRACK-CHECKLIST.md` remains untouched: these checks are local evidence only.

- Approved White / Ink / Cornflower / Grey tokens now apply to marketing, documentation, dashboard and payment surfaces. Existing semantic aliases remain compatible. Tailwind `text-on-brand` is Ink; use it with `bg-brand`. Every existing Cornflower action was checked for White text and migrated. Ordinary small links use Ink. Functional error/warning roles use their documented accessible colours.
- New editorial landing includes original code-native invoice, dispatch and record-table scenes, deliberately arranged pixel-cloud texture, business audience, financing conditions and testnet limits. The headline and category are the supplied candidates; founder confirmation remains outstanding. Nothing guarantees investor funding or same-day payment.
- Docs have resource tabs, section navigation with current-page semantics, a reading column, reference rail, copy-page feedback and a real `/llms-full.txt` link. Clipboard denial gives an actionable fallback. Docs examples now persist retry keys and invoice/amount bindings; signed webhook samples match stored invoice/status/exact amounts before an atomic fulfil-once adapter. Generated full reference was updated from those same tested examples.
- Shared focus, 44 px controls, input boundaries and reduced-motion rules are present. Mobile dashboard navigation uses the full available width. Existing empty/error/payment states remain; missing product images have a named placeholder.
- Existing transactional email template already uses the approved four colours, accessible Ink/White action and plain-text alternative; no email code change was necessary.

## Typography and brand assets held

No evidence of Adobe Fonts entitlement, permitted domains or exact weights was established. No trial, protected-reference or font binary files were read/copied/committed. Existing Adobe stylesheet and local Onest/Geist fallbacks remain. Screenshots intentionally block external requests, so they show permitted fallback typography, **not** proof of Neue Haas Grotesk or All Round Gothic loading.

Favicon and social image contain only the full lowercase `stenmont` text. The old scaffold icon is removed. The SVG declares All Round Gothic with system fallback; isolated SVG resources cannot inherit the page's font loading. The 1200 × 630 PNG is explicitly a system-font fallback rendering. Both require a licensed All Round Gothic render before final brand sign-off. No invented symbol or single-letter mark was introduced. The social metadata uses the currently supported staging origin; update `metadataBase` when another public origin is authorized.

## Local verification

- Tests were written first: three brand checks failed on the old theme/landing; the docs-shell check failed before the shell existed. All four now pass.
- Contrast is recomputed from source CSS tokens using WCAG sRGB relative luminance: Ink/Cornflower ≥ 4.5, White/Cornflower < 4.5, muted/White ≥ 4.5 and required input boundary/White ≥ 3.
- `pnpm --filter @stenmont/web typecheck`: passed after final source changes.
- `pnpm --filter @stenmont/web build`: passed (all routes generated).
- Targeted changed-page ESLint: passed.
- `pnpm --workspace-concurrency=1 -r lint`: passed; one existing unused `writeFileSync` warning in `apps/web/e2e/world-enrol.spec.ts`, zero errors.
- Full package regression run: one serialized pass under the shared atomic full-suite lock, Vitest `--maxWorkers=1`; shared 46, SDK 14, React 3, agent 26, x402 15, API 925, MCP 17, facilitator 31, web 222, scripts 22 Vitest + 15 node:test. The first pass covered 1,336 passing tests but initially omitted two app packages. Follow-up under the same atomic lock ran only the missed example-store (10) and install-proof (57): 1,403 tests covered. A later docs correction adds two tests; targeted `test/docs.test.tsx` passed all 22, giving 1,405 tests covered across these runs. No contracts test was run in this brand stream.
- Local Playwright: one Chromium at a time under the browser lock, port 3006. Captured `/`, `/docs`, `/login`, `/signup`, `/dashboard`, `/dashboard/connect`, `/pay/fixture`, `/store/fixture`, `/account` at 1440 and 390 px. All 18 captures were viewed; mobile headline whitespace, crowded navigation and missing-image presentation were fixed and recaptured. No page-level horizontal overflow or page errors. Dashboard/connect/pay/store use intercepted, explicitly labelled local fixtures; account is the genuine no-link state. These are not live-service acceptance screenshots.
- Browser interactions: copy current docs text, clipboard-denied notice, actual full-reference HTTP response. External requests blocked. No sign-up/sign-in/charge/checkout action invoked.
- Private evidence: `/tmp/stenmont-wave1-20261106/w6-shots/` and `results.json`; reproduction script `/tmp/stenmont-wave1-20261106/w6-browser.cjs`. No screenshot bulk committed.

## Remaining verification

Final docs changes were typechecked and linted after the build; the build preceded that copy/example correction. Lead must perform staging/live flows after integration, including actual licensed-font loading and wordmark asset replacement. No screen-reader, full 200% text-zoom audit, exhaustive state-by-state accessibility conformance audit, Cloudflare production build/deploy or provider proof was performed here. New secret/config names: none. No schema, migration, contract or funding prerequisite is introduced.

## 2026-11-06 · 17:51 IST · docs correction

Quickstart and generated agent instructions now require an already-funded payer. The Fetch and SDK examples reuse a durably stored order checkout key, save the returned invoice binding before redirecting, and check signed events against that binding before fulfilment. Two added tests cover persisted keys and rejected wrong invoice/amount/partial-payment events; all 22 docs tests pass. The actual baseline testnet pay component still invokes a faucet when insufficiently funded; that business-logic conflict is reported to the lead, not changed in the brand stream. The first complete-run report omitted two app packages; their follow-up results and corrected totals are recorded above.
