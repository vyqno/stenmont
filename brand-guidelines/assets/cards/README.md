# Stenmont story cards

A 10-slide portrait carousel (1080 x 1350) plus two landscape banners (1920 x 1080), built with the before/after teaching-card format: a numbered eyebrow, a two-tone headline (ink, then grey), a light sub-line, one instruction line, then a Before card and an After card, each with a pill and a one-line caption, and a `n/10` counter.

The format is inspired by a third-party design carousel (numbered tips, flat Before card, high-contrast After card). All content, UI and art here are original. No third-party brand, logo, text or image is used, and none is committed.

## Concept

Stenmont is the commerce and finance platform for stablecoin businesses, installed and run by the business's own financial agent. The loop is: sell, get paid, close the books, get funded. Each slide teaches one design idea through one real Stenmont capability, drawn from HTML/CSS/SVG components with sample data (not screenshots).

| Slide | File | Idea | Before | After (weight) |
|---|---|---|---|---|
| 1/10 | `01-cover.png` | Cover | none | Agent console doing several jobs, cropped (ink) |
| 2/10 | `02-setup.png` | Space | 12-step checklist and docs tabs | One prompt card and the 4-check Connect panel (ink) |
| 3/10 | `03-store.png` | Grouping | Sheet, links tool, site editor | One catalogue with vector product art, imported chip, public store page (grey) |
| 4/10 | `04-get-paid.png` | Contrast | Generic payment link | Pay page: verified business, named B2B buyer and 3 business instalments, one black button (cornflower) |
| 5/10 | `05-books.png` | Type | Messy spreadsheet | "Month closed", proof root, CSV / QuickBooks / Xero (white, ink outline) |
| 6/10 | `06-collections.png` | Control | Hand-written overdue emails and a chase list | Reminder draft, actual discount/instalment/extension policy limits, Approve / Deny; no delivery (ink) |
| 7/10 | `07-agents.png` | Sequence | Copy and paste between systems | ENS name, agent card, quote, invoice draft, human approval and existing pay link (grey) |
| 8/10 | `08-consent.png` | Scope | Redacted API key in a chat | Consent with read and draft, World approval for a large action, Disconnect (cornflower) |
| 9/10 | `09-capital.png` | Order | 51 dots: observed average days-to-pay in the 2025 dataset | Listed, Funded, Settled timeline, explicit reserve/advance and public claim URL (cornflower) |
| 10/10 | `10-cta.png` | CTA | none | "Start with one prompt." with one prompt card (ink) |
| banner | `wide-01-cover.png`, `wide-10-cta.png` | 1920 x 1080 | | |

Also: `contact-sheet.png` (all 10 slides and both banners) and `stenmont-story.pdf` (vector, 10 pages, one per portrait slide; the renderer fails if the page count is not 10).

## Copy used

- Eyebrow and category: "The agentic business kit."
- Cover headline: "Sell. Get paid. Close the books. Get funded." Sub-line: "Commerce and finance for stablecoin businesses, installed and run by your own agent. Testnet." Banner sub-line: "Billing, books, collections and agent-to-agent commerce, installed by your own agent. Testnet."
- Headlines: "One prompt. Not a project." / "Sell from one place, not five tabs." / "Make one button impossible to miss." / "Close the month without a spreadsheet." / "Let the agent draft. You decide." / "Let agents do the back-and-forth." / "Stop pasting keys. Grant scoped access." / "Invoice funding. On clear terms." / "Start with one prompt."
- Footer on every content slide: "Sample data · Whitechain test network". CTA footer: "Whitechain test network. Test USDT only."
- The only external statistic: "In Sidetrade’s 2025 dataset: 51 days to get paid." with the source line "Sidetrade, 10 Feb 2026 · global B2B dataset" (slide 9).

## Honesty

Every figure is sample data and labelled. No traction, no fee claims, no guarantees ("Depends on an investor"). Testnet and test USDT are stated. No third-party assets or marketing copy are reproduced. Product integration names are used as labels. The consent card uses the real UI label "Disconnect"; the caption says "revoke any time". The wordmark appears only as a small lowercase "stenmont" attribution, set in All Round Gothic.

## Brand

Palette: #FFFFFF, #050505, #548CFF, #E8E9EC (tints of these by opacity), plus the functional success green on status ticks only. Headings are Neue Haas Grotesk Display 700, body Neue Haas Grotesk Text 400/700, wordmark All Round Gothic 400, all from the Adobe Fonts kit `https://use.typekit.net/szp4mzp.css`. Font files are never committed. The renderer fails if the kit's faces do not load, so a fallback cannot be rendered by accident.

## Regenerate

```sh
node scripts/gen-cards/render.mjs            # all slides, contact sheet and PDF
node scripts/gen-cards/render.mjs --slide 04 # one slide while iterating
```

Needs Playwright Chromium (already a dev dependency of `apps/web`) and network access to the font kit. The script serves the page from `localhost` (the kit's domain list includes it), runs one browser, and writes here. Source: `scripts/gen-cards/` (`tokens.css` shared tokens, `slides/*.html` one template per slide, `partials/` shared console and prompt card).

## Capability boundaries and statistic source

These are labelled sample illustrations, not screenshots or live execution evidence. The agent console is an illustrative workflow; a successful live finance-chat provider reply is not yet verified. Collections approval records intent only: no email-delivery adapter runs. Its actual policy controls are discount, B2B instalment count and extension days; exceptions require normal human/World approval. Payment instalments are B2B only, for a named buying business. Receipts are available in the app; outbound transactional email stays in the sink. Payers supply their own USDT.

Books proofs are service-signed interim snapshots; no onchain anchor is configured. Capital depends on eligibility, human approvals and investor funding, with no payment/funding guarantee. The sample investor price850 includes reserve85 and immediate merchant advance765. Certificates use the real public /claim/<invoice-id> route; invoice ENS wildcard names are not supported. A2A reads and drafts; a person creates a payable invoice before its existing pay link can be retrieved.

Primary source for slide9: [Sidetrade, 10 February2026 — global payment data](https://www.sidetrade.com/news/sidetrade-data-lake-2025/). The observed2025 average is51days-to-pay:32days contractual terms plus19days delay. This is Sidetrade’s global dataset, not a census of all B2B transactions, and51days is not a measure of lateness.

The portrait CTA links to the actual staging app, `app-staging.stenmont.com`; no production deployment is represented.
