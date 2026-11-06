# Whitechain Builders Program: application draft

Status: draft for the founder to review and submit. Items in square brackets are for the founder to fill in; nothing here is invented. There is no user traction yet and this draft does not claim any.

## One line

Stenmont is the business payments kit for Whitechain: a business accepts USDT with no crypto knowledge on either side, then refunds, bills again, exports to its accountant, sells an unpaid invoice for cash today, and delegates limited work to AI agents.

## Team and prior execution

[Founder to fill in: names, roles, relevant prior work, and links. The repository is authored by Hitesh (vyqno).]

## Problem

Businesses that bill across borders wait days to be paid, lose a cut on the way, retype every payment into the books, and then wait 30 to 90 days on invoices to have cash. Stablecoins fix the first part, but a business still needs the back office around them, and its customers will not learn wallets and gas. Whitechain's own stated gap is exactly that operational layer: reconciliation, accounting exports, counterparty controls, and products an ordinary business can adopt.

## What exists and works (staging, Whitechain Sepolia 1874, test USDT)

Demo: https://app-staging.stenmont.com. Example shop that adds Stenmont in 10 lines: https://shop-staging.stenmont.com. Code and setup: the repository README. Demo video: [link once recorded].

| Area | What is working | Evidence |
|---|---|---|
| Get paid | Invoices, hosted pay page, passkey payer, gasless (merchant's gas tank pays), signed webhooks | README "Real payments"; 1.00 USDT paid in a store built from our Connect prompt |
| After the payment | Passkey-signed refunds, subscriptions with renewals and cancel, accountant export (generic, QuickBooks) | Live staging runs recorded in `BUILDER-NOTES.md` |
| Plug in | SDK, React button, example shop, `llms.txt`, OAuth-protected MCP server, Connect page with four checks | Real MCP Inspector completed OAuth and listed tools against `mcp-staging.stenmont.com/mcp`; `docs/INSTALL-ACCEPTANCE.md` |
| Get paid early | Invoice financing contracts with investor allowlist, restricted transfers, automatic settlement | Full lifecycle on the current contracts with the official USDT (README links) |
| Agents | x402 facilitator we run; agent client with per-request, daily and host limits; ENS agent names with policy records | Settled 0.01 USDT agent payment (README) |
| Identity | ENSv2 business names with record-scoped roles and a payout lock; World ID one person, one business | Live on Sepolia and World's simulator |

Verifiably, at the time of writing: six verified contracts on Whitechain Sepolia, about 270 commits made over two days, and 1,341 passing Vitest tests plus contract unit, fuzz, invariant and fork tests.

## What is not proven

- No real user, no real merchant, no revenue, and no traffic beyond our own test runs.
- Testnet only; production is not deployed. No external audit; ownership is one wallet until a multisig exists.
- The financing lifecycle used a labelled test shortcut for investor allowlisting (it bypasses the World proof), and the default path was only tested in unit and fork tests.
- A real World Agent Pass sign-in by a person has not been completed; the document-check verification tier is a sandbox stand-in; a lost passkey cannot yet be recovered.
- We have not confirmed that the official USDT will be available on Whitechain mainnet.

The full list is in the README "Current limitations" and `docs/TRACK-CHECKLIST.md`.

## How this brings new businesses and users to Whitechain

Each business that adopts the kit brings its customers' USDT flows to Whitechain. The adoption path is built to be short for both humans and AI agents: paste one prompt into the coding agent that already runs the site, or connect the agent through OAuth to the MCP server; the dashboard reports whether the site is accepting payments. Payers bring their own USDT and Stenmont links to Whitechain's WhiteBIT and Portal bridge for getting it onto the chain; we do not sell USDT or run an on-ramp.

## Distribution plan (plans, not results)

1. Developers and agents: publish the SDK and React packages (the npm organisation is reserved; publishing waits on the founder), keep `llms.txt` and the docs current, list the MCP server.
2. Stores that already exist: the Shopify import (CSV, token and one-click connect) lowers the cost of moving a catalogue; plugins for Shopify and WooCommerce are a later milestone, not built.
3. Freelancers, studios and exporters billing across borders: payment links and invoices with no code; start with a small closed pilot.
4. Partners: Whitechain's builder network, and accounting firms through the export formats.

[Founder to add: named pilot candidates only if there are real conversations.]

## Milestone plan

Funding amounts are for Whitechain and the founder to agree; this plan only orders the work.

| # | Milestone | Done when |
|---|---|---|
| 1 | Make it safe to hold value | Independent contract audit and fixes; multisig owner and guardian; production deployment once USDT availability on Whitechain mainnet is confirmed |
| 2 | Make accounts recoverable | A second-passkey recovery flow with tests, self-serve gas-tank top-up, gas accounting for every relayed action |
| 3 | Make verification real | A real KYC/KYB provider and sanctions screening with a named data source, replacing the sandbox tier; legal review of invoice financing before any real investor |
| 4 | Close the books | Reconciliation view, tax lines, period close with a signed export, more accounting formats, Shopify and WooCommerce plugins |
| 5 | Pilot | A small number of real businesses taking real payments with the owner's weekly review; publish what happened, including failures |
