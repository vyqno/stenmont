# Accessibility

Target WCAG 2.2 AA for implementation; this specification is not a conformance audit. Contrast measurements are in COLORS.md. Normal text: 4.5:1; large text: 3:1 (24 px regular or about 18.7 px bold); essential component boundaries and icons: 3:1.

Use Ink on Cornflower. White on Cornflower fails for normal text. Neutral Grey is decorative on White; use the specified stronger boundary for inputs. Underline links and label status with words. Disabled controls may use reduced contrast, but explanations and financial data never do.

## Interaction checklist

- All controls have visible labels, native semantics and keyboard access.
- Focus is visible on White, Grey, Ink and Cornflower; not hidden by sticky headers.
- Aim for 44 × 44 px touch targets; never use tiny icon geometry as the hit area.
- At 320 CSS px width and 200% text zoom, preserve content and task order. Tables may scroll with an announced region.
- Errors identify the field, explain correction and preserve valid input.
- Loading and asynchronous results are announced without stealing focus.
- Amounts include currency; dates include the relevant zone; ambiguous abbreviations are expanded.
- Motion respects reduced-motion settings. SVG diagrams carry title/description and have a text equivalent.
- Email has a meaningful heading order, descriptive links, live text and plain text alternative.

Verify with keyboard navigation, screen reader, zoom, reduced motion, contrast computation and actual mobile rendering before claiming implementation compliance.
