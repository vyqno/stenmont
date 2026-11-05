# Asset prompts

Everything the website, the app and the demo video need, as prompts you can paste into an image generator or hand to a designer. Final files go in `brand-guidelines/assets/` using the filenames below. Colours are in [COLORS.md](COLORS.md); never ask a generator for other colours.

## How to use

1. Paste the **global style** first, then one asset prompt.
2. Ask for the exact size and background in the table. Re-roll until it matches the rules; do not paint over colours later.
3. Keep every asset in the same family: same line weight, same corner radius, same palette. If one looks different, regenerate it.

## Global style (always first)

> Precise, calm, trustworthy financial illustration in a modern Swiss style, in the spirit of Neue Haas Grotesk typography. Flat vector, no gradients except a very subtle one on dark backgrounds, no 3D, no photorealism, no text unless told. Geometric shapes with rounded corners (radius 12% of the shape), 2 px consistent outline weight, generous empty space, a subtle dot-dither texture as the only decoration. Palette only: navy #080a28, deep background #000722, surface #000933, white #ffffff, mint #68ecbc, pastel mint #a4f4d7, one small lime #dcf218 highlight per image, soft grey #c7d0dc, blue #0066ff for links only. No crypto clichés: no coins, no chains, no wallets, no rockets, no padlocks, no blockchain cubes, no Bitcoin or Ethereum logos. The mood is a well-run business, not a trading app.

## Rules

- No crypto symbols anywhere customers see. The product is about getting paid and keeping the books, not about the technology.
- Dark and light versions are separate files with a `-dark` suffix.
- One lime accent per image, at most.
- SVG for icons, PNG at 2x for illustrations, WebP copies for the web.

## A. Brand

| File | Size | Notes |
|---|---|---|
| `logo-wordmark.svg` and `-dark.svg` | vector | Not generated: set "stenmont" per [LOGO.md](LOGO.md). Navy on light, white on dark. |
| `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` (180) | 32, 180 | Lowercase "s" in All Round Gothic, white on navy `#080a28`, rounded square. |
| `og-image.png` | 1200 x 630 | Prompt: *Wide banner, deep navy background with a faint dot grid. Left third empty for the headline. Right: a clean invoice document tilted slightly, a mint check badge overlapping its corner, and a thin mint line connecting it to a second smaller card labelled with a bar chart. One lime dot as the only highlight.* |

## B. Marketing illustrations (PNG 2x, transparent background)

| File | Size | Prompt (after the global style) |
|---|---|---|
| `hero-paid-in-a-second.png` | 1600 x 1000 | An invoice card on the left turning into a "paid" card on the right through a short horizontal mint line, tiny clock arc above showing one second. Calm, centred, lots of space. |
| `how-get-paid.png` | 800 x 600 | A hand-held phone showing a single large button and a fingerprint outline; a faint arrow into a stack of settled invoices. No wallet or coin imagery. |
| `how-books-close.png` | 800 x 600 | A neat ledger book closing, a mint check on its cover, receipts and bars flowing into its pages from the left. |
| `how-get-paid-early.png` | 800 x 600 | An open invoice on a calendar date being handed to a person with an outstretched hand across a table, cash drawn as a plain mint rectangle. Business meeting, no charts of tokens. |
| `agents-with-limits.png` | 800 x 600 | A friendly abstract assistant (a rounded square with two dots for eyes) holding a clipboard, a dotted boundary line around it, and a person's hand stamping an approval on a card outside the boundary. |
| `trust-human-approval.png` | 800 x 600 | A shield made of two simple shapes with a person silhouette inside, a mint tick, a faint ring of dots around it. |
| `works-with-whitechain.png` | 1200 x 300 | A thin horizontal band: the Stenmont wordmark placeholder, a plus sign, a rounded empty slot labelled "Whitechain logo goes here". |

## C. Icon set (SVG, 24 x 24 grid, 1.5 px stroke, round caps and joins, one colour that inherits `currentColor`)

Prompt for each: *"[name] icon, 24 px grid, 1.5 px stroke, rounded caps, single colour, no fill, minimal."* Generate the whole set in one sheet so they match.

`invoice` (page with folded corner and lines) · `payment-link` (page with a small link loop) · `checkout` (shopping bag with a check) · `refund` (arrow returning along a curve) · `subscription` (circular arrows around a small calendar) · `reminder` (bell with a small clock) · `export` (page with an arrow leaving) · `ledger` (open book with rows) · `webhook` (two nodes joined by a line) · `api-key` (a small key) · `fees-covered` (a hand holding a small tag) · `passkey` (fingerprint arcs) · `verified-human` (person with a check) · `agent` (rounded square with two dots) · `approval` (a stamp) · `advance` (a calendar date with an arrow to a rectangle) · `investor` (a person with a bar chart) · `reputation` (a half-circle gauge) · `business-name` (a rounded tag with an at sign) · `books-closed` (book with a check) · `team` (two people) · `settings` (sliders) · `search` · `warning`.

## D. Invoice visuals (the product's centre of gravity)

| File | Size | Prompt (after the global style) |
|---|---|---|
| `invoice-light.png` | 1000 x 1300 | A realistic but simplified A4 invoice on a light grey desk: wordmark top left as a small rounded rectangle, a table of three line items with right-aligned amounts, a subtotal block, a large mint "Paid" stamp rotated 8 degrees in the corner, a thin navy header bar. All text drawn as grey bars, not readable text. |
| `invoice-dark.png` | 1000 x 1300 | Same invoice on the deep navy `#000722`, document surface `#000933`, mint stamp. |
| `receipt.png` | 800 x 1200 | A narrow receipt strip with a mint check at the top, three grey line bars, a total bar, a faint dotted tear line. |
| `credit-note.png` | 1000 x 1300 | Like the invoice but with a warning-orange `#ed7536` top bar and a curved return arrow. |
| `payment-link-card.png` | 900 x 500 | A rounded card with a short link bar, a large amount bar, and a single mint pay button shape; a small QR-style dot grid, drawn abstractly. |
| `statement-aged.png` | 1200 x 700 | An "aged receivables" bar chart: four bars (current, 30, 60, 90+) in mint, soft grey, warning orange, error red, on a card. |

## E. Pay page

| File | Size | Prompt (after the global style) |
|---|---|---|
| `pay-confirm-device.png` | 600 x 600 | A phone with a soft glowing fingerprint outline in mint, nothing else. |
| `pay-success.svg` (and a 1 second animated version) | 240 x 240 | A mint circle drawing itself, then a white check mark drawing inside it, then a tiny lime spark. |
| `merchant-avatar-01.png` to `-05.png` | 256 x 256 | Five abstract business avatars (a coffee cup, a camera, a laptop, a plant, a toolbox), each in a rounded square, mint and navy only. |
| `pay-error.svg` | 240 x 240 | A soft orange circle with a small "!" drawn as a dot and a bar, calm, not alarming. |

## F. Empty states (PNG 2x, 480 x 320, transparent)

`empty-invoices` (an empty tray with one dashed document outline) · `empty-payments` (a paper plane over a dotted path, not yet landed) · `empty-customers` (two empty avatar circles) · `empty-subscriptions` (a calendar with a dashed ring) · `empty-agents` (the agent square asleep, with a "z") · `empty-financing` (a tiny dashed scale).

## G. Backgrounds and patterns

| File | Size | Prompt |
|---|---|---|
| `pattern-dither-light.svg` | tile 120 | A subtle ordered-dither dot pattern in `#dfe5ec` on `#f8faf9`, seamless. |
| `pattern-dither-dark.svg` | tile 120 | The same on `#000722` with dots `#122a5e`. |
| `section-glow-dark.png` | 1920 x 800 | A very soft mint glow at the bottom left of the deep navy background, barely visible. |

## H. Demo video and pitch (PNG 1920 x 1080)

`title-card` (wordmark centred, one-line promise: "Get paid. Close the books. Get paid early.") · `party-merchant` · `party-customer` · `party-investor` · `party-agent` (each a lower-third tag: a small icon from the set, the party name, a mint underline) · `step-card-1` to `step-card-5` (numbered, plain) · `end-card` (the wordmark, the repository address, "Built on Whitechain" placeholder). Slide template: dark background, wordmark bottom left, page number bottom right, one lime accent.

## Consistency checklist (run before adding an asset)

- [ ] Palette tokens only (eyedrop the colours)
- [ ] Stroke 2 px (illustrations) or 1.5 px (icons), rounded
- [ ] No crypto imagery, no readable text unless the table says so
- [ ] Dark version exists if the asset appears on a dark section
- [ ] Filename matches the table; SVG where possible
