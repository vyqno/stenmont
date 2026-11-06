# Visual language

## Geometry from business records

Use the aligned record column and event rail introduced in BRAND-STRATEGY.md. Rectangular records sit on a baseline; a thin rule connects verified stages. A node represents an event, not a coin or token price. Every node needs a human-readable label in explanatory diagrams.

| Element | Rule |
|---|---|
| Illustration canvas | 800 × 400, 32 px safe margin |
| Stroke | 2 px at native illustration size |
| Geometry | Orthogonal paths, circular event nodes, 4 px corners |
| Hierarchy | Ink structure, Cornflower emphasis, Grey support, White space |
| Labels | Selected supporting type, 16 px minimum in the final rendered size |
| Complexity | 3–5 stages per diagram; split longer journeys |

Illustrate actual concepts: merchant connects a site; an invoice receives a payment; a webhook updates a record; a human approves an agent request. Include a legend when a line means an asynchronous event. Do not draw a direct-bank payout or onchain spending guarantee unless implemented and verified.

## Pattern

`assets/patterns/record-grid.svg` is an original proposed secondary pattern, not logo geometry. Its repeat is 32 × 32 units with a fine Grey rule. Use at most one quiet region per composition. Never place it behind amounts, body text or controls. Test the repeat across tile edges.

## Image rules

Use diagrams before decorative imagery. No glowing gradients, glass panels, floating coins, chain logos, random 3D objects or mascots. Product captures must come from a real run with permission and contain no secrets. Every conceptual composition must say “Concept — not a product screenshot.”

The supplied flow illustration explains a possible sequence and is labelled conceptual; it is not an integration test or proof of automatic reconciliation.
