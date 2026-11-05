# Colours

Stenmont lives inside the Whitechain ecosystem, so it uses Whitechain's own palette (read from whitechain.io on 2026-11-06). Do not invent new colours; add a token here first.

## Core

| Token | Hex | Use |
|---|---|---|
| `navy` | `#080a28` | primary dark, logo on light, dark sections |
| `ink` | `#07081e` | body text on light |
| `bg-dark` | `#000722` | page background, dark mode |
| `surface-dark` | `#000933` | cards on dark |
| `bg` | `#f8faf9` | page background, light mode |
| `surface` | `#ffffff` | cards on light |
| `border` | `#c7d0dc` | lines on light |
| `border-dark` | `#1e3d80` | lines on dark (muted: `#122a5e`) |

## Accents

| Token | Hex | Use |
|---|---|---|
| `mint` | `#68ecbc` | success, primary accent, "paid" |
| `mint-pastel` | `#a4f4d7` | soft fills behind success |
| `lime` | `#dcf218` | the one highlight: key number, selection, badge (use sparingly) |
| `blue` | `#0066ff` | links and primary buttons on light (hover `#3385ff`) |

## Text and status

| Token | Hex | Use |
|---|---|---|
| `text-1` | `#07081e` | headings, body on light |
| `text-2` | `#4a5567` | secondary on light |
| `mute` | `#97a2b6` | placeholders, disabled |
| `text-dark-1` | `#ffffff` | text on dark |
| `text-dark-2` | `#9fb2cc` | secondary on dark |
| `error` | `#e24137` | errors, failed |
| `warning` | `#ed7536` | warnings, overdue |

## Rules

- Light mode and dark mode both exist; dark uses `bg-dark` and `surface-dark`.
- Success is always mint, overdue is always warning, failed is always error.
- Lime never carries body text and appears at most once per screen.
- Text on mint or lime is `ink`; text on navy is white.
