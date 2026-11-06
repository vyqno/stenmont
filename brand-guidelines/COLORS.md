# Colour system

## Approved core

| Colour | Hex | Role |
|---|---|---|
| Paper White | #FFFFFF | Primary background, reversed text on Ink |
| Ink | #050505 | Primary text, dark surfaces, primary action |
| Cornflower | #548CFF | Restrained accent; Ink text on accent surfaces |
| Neutral Grey | #E8E9EC | Secondary surfaces and decorative dividers |

Suggested distribution: White 55%, Ink 30%, Cornflower 10%, Grey 5%. This is composition guidance, not a quota. No navy, mint, lime, purple or unrelated gradients in new-brand assets.

## Semantic tokens — specification only

| Token | Value | Use |
|---|---|---|
| primary / text | #050505 | Primary action and readable text |
| secondary / surface | #E8E9EC | Secondary surface |
| accent | #548CFF | Emphasis, selected surface |
| background | #FFFFFF | Canvas |
| border-decorative | #E8E9EC | Nonessential separators |
| border-control | #6B6B6B | Required input boundaries |
| text-muted | #595959 | Supporting text on White |
| interactive-hover | #3975ED | Accent hover with Ink label |
| success | #17643B | Functional success; separate from core palette |
| warning | #805500 | Functional warning; separate from core palette |
| error | #B42318 | Functional error; separate from core palette |
| disabled | Ink at 40% on Grey | Disabled controls only, never essential information |

Status hues are functional recommendations; use with text/icon labels. Never treat red or green as a second brand accent. Dark surfaces use White text; secondary text there remains White until a measured alternate is documented.

## Measured contrast

Computed from WCAG sRGB relative luminance. Normal text needs 4.5:1; large text and essential non-text graphics need 3:1.

| Pair | Contrast | Use |
|---|---|---|
| ink / paper | 20.38:1 | Normal text |
| ink / cornflower | 6.38:1 | Normal text |
| paper / cornflower | 3.20:1 | Large text only |
| ink / grey | 16.79:1 | Normal text |
| muted / paper | 7.00:1 | Normal text |
| border / paper | 5.33:1 | Normal text |
| success / paper | 7.19:1 | Normal text |
| warning / paper | 6.53:1 | Normal text |
| error / paper | 6.57:1 | Normal text |
| ink / hover | 4.80:1 | Normal text |

White small text on Cornflower fails normal-text contrast. Use Ink there. Cornflower text on White is suitable only at large text sizes; ordinary links use Ink plus underline. Grey is not an accessible input boundary on White.

## Legacy, current app — migration table

These Whitechain tokens remain in application source. The table is a future semantic migration, not an instruction to replace strings or change Workers.

| Current token(s) | Current value(s) | New-brand destination |
|---|---|---|
| navy / ink / text-1 | #080A28 / #07081E | Ink #050505 |
| bg-dark / surface-dark | #000722 / #000933 | Ink #050505; separate areas with borders |
| bg / surface | #F8FAF9 / #FFFFFF | Paper White #FFFFFF |
| border / border-dark | #C7D0DC / #1E3D80 | Decorative Grey or control #6B6B6B by purpose |
| mint / mint-pastel | #68ECBC / #A4F4D7 | Success #17643B for status; Cornflower only for brand emphasis |
| lime | #DCF218 | Remove highlight; use layout emphasis or Cornflower sparingly |
| blue / hover | #0066FF / #3385FF | Cornflower surface + Ink label; Ink underlined text links |
| text-2 / mute | #4A5567 / #97A2B6 | #595959 on White; disabled exemption only when truly disabled |
| text-dark-1 / text-dark-2 | #FFFFFF / #9FB2CC | White on Ink |
| error / warning | #E24137 / #ED7536 | Functional #B42318 / #805500 |

Migration gate: review each semantic role, contrast, keyboard focus and status meaning; update app in a separately authorized change. Current brand documentation changes no CSS or runtime tokens.
