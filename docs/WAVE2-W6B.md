# W6b · visual system and route review

## 2026-11-06 · 18:20 IST

Built on `10b3d69` in an isolated clone. Main checkout untouched. No push/deploy/account creation, real service writes, payments, email or funding. The eight specified reference images were viewed first; they supplied treatment guidance only. No reference image, subject, copy or asset was copied into the app.

## Implemented

- Shared grey panels, white rounded cards, pill navigation, faint shadows and original monochrome invoice/receipt/certificate/store/passkey scene chips. Large editorial hero; the rejected pixel strip is not used.
- Keyboard feature tabs for Get paid / Books / Sell invoices / Agents, with explicitly labelled sample financial records, customer/investor perspective, financing timeline/certificate and draft-only chat. Existing Badge component reused; these previews do not make service calls.
- Original globe/payment-arc, invoice/claim/settlement layers and business/buyer/investor/agent diagrams. All labelled conceptual.
- Dark developer band with keyboard Prompt/cURL tabs and real reference links. Prompt requires an already-funded payer and makes no installation-proof claim.
- Mobile Menu is keyboard accessible. Inactive panels remain mounted with correct hidden semantics and stable tab/panel relationships.
- Shared treatment applied to docs, dashboard shell, pay, auth/consent, account, investor/certificate, store and subscription surfaces. Existing wrappers were restyled; no new metadata layouts or business logic. Empty dashboard canvas now takes its natural height. Pay has a compact wordmark/test-network header. Missing product images have an explicit placeholder.
- FAQ navigation added for the W14 SEO page. The FAQ and its helpers were temporarily borrowed from the same project worker solely for capture, then removed; W14 owns and must merge them.

## Confirmed typography

Sir confirmed **Regular 400 at a moderate size, not bold** for the full lowercase stenmont wordmark. Global default is 20 px, All Round Gothic; no symbol or single-letter mark. Headings select Neue Haas Grotesk Display; body/UI/code select Neue Haas Grotesk Text. `font-synthesis:none` prevents fabricated weights.

The existing Adobe project returned HTTP 200. Browser FontFace loading and Chrome platform-font inspection established actual custom fonts: `AllRoundGothic-Book`, `NHaasGroteskDSPro-75Bd` for the hero and `NHaasGroteskTXPro-55Rg` for body. The project offers 400/700; no missing 500 face is a gate because the founder selected 400. No font binaries were copied or committed, and no font account/purchase was changed.

The social image (1200×630, wordmark at 80 px) and favicon (160×160, wordmark at 22 px) are raster captures of the **actual loaded** Gothic Regular. Each capture refused to proceed unless FontFace loading and platform-font inspection proved the custom face. The standalone fallback SVG was removed. These replace the old bold system-font artwork.

## Validation

- Tests first: semantic sample/tab test failed before implementation; non-bold wordmark regression failed against old 700 CSS.
- Final targeted Vitest: 58 passed across homeVisual/home/brand/docsShell/docs/pay/subscribe/oauth, `--maxWorkers=1`.
- Local Playwright: 3 passed (feature keyboard controls and sample labels, mobile keyboard menu plus 400/20 px logo, existing no-autofunding regression). All financial/API requests intercepted; no real signing or transactions.
- Final web typecheck and changed-file ESLint passed. Production `pnpm --filter @stenmont/web build` passed under the shared atomic lock after the final source changes. No duplicate full baseline suite; lead owns combined integration regression.
- 34 route patterns × desktop/mobile = 68 captures, reviewed using contact sheets plus native key captures. This covers all 33 page files in this base and the W14 FAQ. Dynamic IDs/merchant data use clearly labelled local fixtures. No page-level horizontal overflow or page errors in final inventory. One initial verification-fixture shape lacked `wallets:[]`; corrected the fixture and recaptured, with no product change.
- Additional 7 states × 2 widths = 14 captures: dashboard loading/error; pay missing/paused/paid; store empty/missing. Four feature panels captured at both widths. Native final hero frames are 1440×1000 and 390×900. Fonts were allowed and loaded for final captures. Final home/product-image fixes were recaptured against the production build.
- Private evidence directory: `/tmp/stenmont-wave1-20261106/w6b-shots/`; route/state JSON inventories, review sheets, full captures and native frames. Font proof: `/tmp/stenmont-wave1-20261106/w6b-fonts.json` and `w6b-asset-font-proof.json`.

## Route coverage (each at 1440 and 390 px)

- `/`
- `/account`
- `/claim/fixture`
- `/dashboard`
- `/dashboard/agent`
- `/dashboard/books`
- `/dashboard/catalog`
- `/dashboard/collections`
- `/dashboard/connect`
- `/dashboard/financing`
- `/dashboard/identity`
- `/dashboard/import`
- `/dashboard/invoices`
- `/dashboard/settings`
- `/dashboard/subscriptions`
- `/dashboard/verification`
- `/docs`
- `/docs/api`
- `/docs/faq`
- `/docs/mcp`
- `/docs/sdk`
- `/docs/webhooks`
- `/docs/x402`
- `/invest`
- `/invest/fixture`
- `/invest/portfolio`
- `/login`
- `/oauth/authorize`
- `/pay/fixture`
- `/signup`
- `/store/fixture`
- `/store/fixture/cart`
- `/store/fixture/sample`
- `/subscribe/fixture`

## Limits and handoff

This is visual fixture coverage, not staging/provider/chain/installation proof. Investor detail and public certificate were reviewed in missing-record states; portfolio/device and account/no-link states were reviewed. Books begins at month selection; it is not a live signed-bundle demonstration. No real provider chat, World approval, funded claim, receipt or checkout was executed. No exhaustive every-state, screen-reader or 200% text-zoom conformance claim. W14 owns canonical/robots/sitemap/JSON-LD and route metadata; this stream adds no such files. Any routes introduced after this base need follow-up review. Browser, server and shared locks released. New secrets/config/migrations/contracts: none.
