# Brand applications

These are composition specifications, not screenshots or claims of implemented features. Every future visual mockup must be labelled “Concept — not a product screenshot.” Use the approved wordmark only once the actual artwork is supplied.

| Application | Composition | Essential content |
|---|---|---|
| Marketing website | 12 columns; left-aligned headline; one evidence diagram | Product explanation, integration path, staging limits |
| Merchant dashboard | Compact navigation; sectioned operational workspace | Amounts, dates, confirmation, next task |
| Checkout | 560 px column; merchant and amount first | What is being paid, action, receipt, retry state |
| Developer portal | Navigation + reading column + code examples | Environment, authentication, quickstart, failures |
| API reference | Stable endpoint headings and parameter tables | Required fields, units, scopes, response examples |
| Transaction table | Aligned description, date, amount, state | Receipt link, readable pending and failure labels |
| Payment confirmation | Concise statement and receipt block | Confirmed amount and merchant; no invented success |
| Business presentation | 16:9; 64 px safe margin; one assertion per slide | Evidence and dated limitations |
| Social media | 1:1 or 4:5; large headline and one diagram | One concrete product fact, readable source/caption |
| Email / business document | 600 px email or A4 document; clear reading order | Transaction details, exact action, support and plain text |

## Example narrative

“Invoice issued” → “Payment confirmed” → “Receipt recorded.” Each stage uses a record node on a common rail. A dotted connector means asynchronous processing, not guaranteed instant completion. `assets/illustrations/payment-record-flow.svg` demonstrates this visual grammar only.

The new email palette may be implemented independently under the transactional-email task. Marketing, dashboard and checkout restyling require a later app migration. Never use a concept illustration as verification evidence.
