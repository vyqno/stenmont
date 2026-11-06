# Collections and B2B instalments

## Progress (IST, 2026-11-06)
- 17:30 — Recovered seven instalment/preflight commits preserving their author timestamps and provenance. Added tenant-bound collections drafts, passkey-session merchant decisions, and exact-parameter World exception checks. Approved drafts remain unsent; no delivery adapter is enabled.

## Current boundaries
Collections tools draft only. A merchant decision records approval or denial; it does not send email, create a payment agreement, or move money. Existing email mode remains unchanged. ENS publication uses the registrar text-record path; older locked names may lack the new record permission and publication then reports failure.
- 17:41 — Exact remainder-first plans use one signed charge plus a second bounded agreement for remaining charges. Activation requires a confirmed cancelled original invoice and exact final outstanding balance. Merchant preparation signs invoice cancellation and derives terms after finality; cancelled originals are never mirrored as router-paid. Both payer and merchant cancellation cover all active agreements.
