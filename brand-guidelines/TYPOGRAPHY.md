# Typography

| Role | Font | Fallback |
|---|---|---|
| Headings, body, UI | Neue Haas Grotesk (Display for large headings, Text for body) | `"Helvetica Neue", Helvetica, Arial, system-ui, sans-serif` |
| Logo only | All Round Gothic (lowercase, tracking 10) | `"Avenir Next", Futura, Onest, sans-serif` |
| Numbers and addresses | a monospaced face | `ui-monospace, "SF Mono", Menlo, monospace` |

Whitechain itself uses Onest; it is a good open fallback for body text if the licensed fonts are not loaded.

## Scale (rem, base 16)

`display 3.5` · `h1 2.5` · `h2 1.75` · `h3 1.25` · `body 1` · `small 0.875` · `micro 0.75`
Weights: 400 body, 500 labels and buttons, 700 headings. Line height 1.5 for body, 1.1 for display.

## Rules

- Amounts are tabular figures (`font-variant-numeric: tabular-nums`) and always show two decimals: `$12.50`.
- Customer-facing text never uses crypto vocabulary (gas, wallet, chain, token, seed). A test enforces this on the pay page.
- Sentence case for headings, no all-caps except the logo rule above (which is lowercase).

## Loading (when licensed)

Put the web fonts in `apps/web/public/fonts/` and declare them with `font-display: swap`; keep the fallback stack so the site renders correctly without them.
