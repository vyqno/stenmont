# Collections and B2B instalments

## Progress (IST, 2026-11-06)
- 17:30 — Recovered seven instalment/preflight commits preserving author timestamps and cherry-pick provenance. Added tenant-bound collections drafts, passkey-session merchant decisions, and exact-parameter World exception checks.
- 17:41 — Remainder-first plans use one bounded signed charge and a second agreement for remaining charges. Merchant preparation cancels the original invoice before deriving final replacement terms. Both payer and merchant cancellation cover every active agreement.
- 17:43 — Added actual replacement charge receipts with transaction hashes and measured gas; state-only resync never invents a receipt. Collections MCP tools and dashboard review queue are connected. Policy writes reject foreign-tenant and recovery-only sessions.

- 17:59 — Customer receipts now include actual replacement charges, with payer and merchant consistency checks. API account tests passed 8/8; account display/helper tests passed 10/10; API and web typechecks passed. No full suite was repeated.

## B2B replacement workflow

Create an invoice with `instalments: 2 | 3`, `b2b: true`, and `payerBusinessName`. The resulting plan is a candidate, not an activatable quote while the router invoice is open. In Subscriptions, choose **Prepare replacement plan**. The merchant signs `CancelInvoice`; the API waits for its receipt, re-reads the final router paid amount, then computes the final outstanding balance. A partial payment mined before cancellation reduces the plan. The original payment link remains cancelled, including if the merchant later withdraws the candidate plan.

The customer signs the final agreement(s) and a single aggregate permission. Even totals use one agreement with the requested charge cap. Remainder totals use a first agreement capped at one charge plus a second capped at `count - 1`; registration and the first due charge are atomic through existing Multicall3. For 100 USDT in three parts, signed terms allow exactly 33.333334 + 2 × 33.333333 USDT. The deployed manager's general cap is 10,000 for ordinary subscriptions; each instalment agreement is separately signed with the smaller cap, so these plan signatures authorize at most three charges in aggregate. No manager, ABI, deployment or contract cap was changed.

Activation refuses an open original invoice, a changed outstanding balance, a financing hook, or missing second signature. Financing refuses invoices with offered or running plans. These checks close the alternate router rail before any instalment authorization is accepted. The original invoice stays **cancelled**, and `invoice.amountPaid` continues to mean actual router payments; manager charges never masquerade as router payment logs. Replacement charges do not feed router reputation, investor settlement or router refund accounting.

## Collections boundaries

`list_overdue` reads only the authenticated business's overdue invoices. `draft_reminder` and `propose_plan` only queue drafts. Invoice metadata and descriptions cannot supply reminder instructions or arbitrary text; reminders use fixed copy and React renders proposal data as text. Only a matching passkey session can approve/deny drafts or change policy. Recovery sessions, OAuth agents and a different merchant's cookie cannot approve actions. Decisions use a pending-state compare-and-set.

Policy is saved locally and can be published as `stenmont.collections` through the registrar-only record path. Existing names locked before this permission was retained may reject publication; the API reports that failure. ENS publication and readback have not been run live. `REGISTRAR_KEYS` preserves policy-record write permissions when a name is locked; businesses and team members receive no rights to them.

A valid two/three-part proposal outside local policy needs a fresh exact-parameter World approval with operation `collections_exception`. Tests deny a three-part proposal with an out-of-policy extension and prove that no draft, subscription or send is created. Plans above three parts are unsupported and rejected as input; a six-part input rejection is **not** presented as World denial. Discounts and automatic execution of approved proposals are unavailable.

Merchant approval records intent only. Nothing is emailed or executed from the review queue; existing email mode remains unchanged and no delivery adapter was enabled. The Collections page states this explicitly. There are no MCP decision/send tools.

## Preflight and cash evidence

The hourly preflight reads public balance and manager allowance within one day of a due charge. It sets separate `atRiskReason`/`atRiskAt` flags and emits `subscription.at_risk`; it never blocks renewal attempts. RPC failure does not blame the payer. Instalment charged, failed and completed events retain their own types.

Migration **0040** adds plan metadata, preflight flags, collections policy/actions and `instalment_charges`. Actual successful activation/cron charges record root plan ID, actual agreement ID, payer, USDT base units, transaction hash, observed UTC time and nullable measured gas cost in WBT wei. Uniqueness by transaction/agreement makes receipt insertion idempotent. Observed time is not claimed as block time. Out-of-band charges can update aggregate state but do not get invented transaction hashes; complete out-of-band receipt indexing and uncertain-send recovery remain follow-up work. Actual manager charge receipts now appear in the customer payments list as replacement plan payments, with their original explorer transaction links and dates explicitly labelled as receipt observation times. The query checks both payer ownership and receipt/invoice merchant consistency. No replacement refund or cancellation action is inferred from a receipt.

The separate Books integration patch is supplied to the lead for review/application. It is not part of this branch and was not tested here. Migration deployment, live manager/ENS/World journeys, browser layouts, real email delivery and staging evidence are not claimed.

## Local verification

- Offline frozen install with lifecycle scripts disabled completed.
- One workspace suite attempt ran serially with one Vitest worker per package. It stopped at one outdated ENS lock-order expectation: API 968 passed / 1 failed. The expectation was updated to include the retained collections permission; the focused real-client file then passed 12/12, including policy-key write coverage. No full API rerun was performed.
- Packages skipped after that failure were completed separately under the shared suite lock. Unique current coverage: API 970 tests (initial suite plus changed-file rerun), web 222, shared 46, SDK 14, React 3, agent 26, x402 15, MCP 20, facilitator 31, install-proof 57, example-store 10, scripts 22 Vitest + 15 Node tests. MCP was inadvertently included again in the continuation; both runs passed.
- API/MCP/shared TypeScript checks and web route generation plus TypeScript checks passed after all code changes.
- Not run: browser/e2e, build, full repository lint, Foundry, staging migrations/deployment, live ENS publication/readback, real World sign-in, any funds transfer. No contract source or ABI was changed. No network write, push, publication, account creation or email send was performed.
