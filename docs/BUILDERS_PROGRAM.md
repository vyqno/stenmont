# Whitechain Builders Program: application draft

Status: draft for the founder to review and submit. Items in square brackets are for the founder to fill in; nothing here is invented. There is no user traction yet and this draft does not claim any.

## One line

Stenmont is a commerce and finance platform for businesses that run on stablecoins: sell, get paid, close the books, get funded. **The agentic business kit** connects a merchant's storefront, USDT checkout, operating records and optional receivable financing; a financial agent can install and help operate it within explicit permissions.

For internal pitch shorthand, think “Shopify for stablecoin commerce”: products and storefronts connect to checkout, orders, customers and the back office. This describes the product direction, not feature parity, Shopify affiliation, equivalent distribution or a proven fee advantage.

## Team and prior execution

[Founder to fill in: names, roles, relevant prior work, and links. The repository is authored by Hitesh (vyqno).]

## Problem

Businesses selling goods, services and subscriptions need the whole operating loop: catalogue, checkout, orders, payments, records and working capital. A stablecoin transfer alone leaves that work fragmented. Merchants should not need seed phrases or network gas to operate; customers who already hold USDT need a clear payment path. Whitechain's own stated gap is exactly that operational layer: reconciliation, accounting exports, counterparty controls, and products an ordinary business can adopt.

## What exists and works (staging, Whitechain Sepolia 1874, test USDT)

Demo: https://app-staging.stenmont.com. Separate realistic merchant store: https://demo-shop-staging.stenmont.com. Code and setup: the repository README. Demo video: [link once recorded; at most four minutes at real speed].

| Business loop | Recorded evidence | Acceptance still open |
|---|---|---|
| Sell | Catalogue, public storefront and cart implemented. Separate demo shop integrated from the Connect prompt through the normal merchant route. | A Shopify bridge test order now has a payment/webhook record; its admin install flow, refunds and broad migration acceptance remain open. The new order-price guard is local-tested, not deployed to the live bridge. Razorpay credentials and payment proof are held. |
| Get paid | Demo-shop order paid after a signed webhook; Connect 4/4; [1.00 test-USDT payment](https://explorer.testnet.whitechain.io/tx/0xe8c96bc95001abd0aedb148bd869d82fb32db5800496c7a3568ea4120d8c34e3). Existing refunds and subscriptions have separate staging evidence. | No production payments or external merchant traction. |
| Close the books | Real signed two-line interim bundle verified offline, with tamper rejection; reconciliation, tax lines and export code implemented. | Onchain anchor is not deployed; no claim of complete books or tax compliance. |
| Get funded | Earlier direct financing lifecycle settled on the deployed contracts; see README and financing walkthrough. | Dashboard “Sell this invoice”, timeline and public certificate with a real World sign-in; router v2 is deployed and partially accepted, with named-buyer discount and acknowledgement receipts. |
| Install and operate | Real OAuth MCP consent, discovery and scoped invoice read; prompt-installed checkout. ENS directory records and a profile-only role grant read on Sepolia; one-day agent name created. | Cloud-backed Gemini reply and the ENS expiry lifecycle are not yet proven. Collections remain drafts/decisions, not sent messages. |

Tests and versions belong in the dated staging reports, not a timeless feature count. Local fixtures, probes and source inspection do not establish live third-party integration. This draft does not claim that all waves are complete.

## What is not proven

- No real user, no real merchant, no revenue, and no traffic beyond our own test runs.
- Testnet only; production is not deployed. No external audit; ownership is one wallet until a multisig exists.
- The financing lifecycle used a labelled test shortcut for investor allowlisting (it bypasses the World proof), and the default path was only tested in unit and fork tests.
- A real World Agent Pass sign-in by a person has not been completed; the document-check verification tier is a sandbox stand-in; email restores dashboard access only, not a lost payout-controlling passkey.
- We have not confirmed that the official USDT will be available on Whitechain mainnet.

The current boundaries are in the README and the dated staging acceptance reports. No mainnet availability, legal eligibility or external audit is implied.

## How this brings new businesses and users to Whitechain

Each business that adopts the kit brings its customers' USDT flows to Whitechain. The adoption path is built to be short for both humans and AI agents: paste one prompt into the coding agent that already runs the site, or connect the agent through OAuth to the MCP server; the dashboard reports whether the site is accepting payments. Payers bring their own USDT and Stenmont links to Whitechain's WhiteBIT and Portal bridge for getting it onto the chain; we do not sell USDT or run an on-ramp.

## Distribution plan (plans, not results)

1. Developers and agents: publish the SDK and React packages (built and install-tested, not yet published; that is the founder's decision), keep `llms.txt` and the docs current, list the MCP server.
2. Stores that already exist: the Shopify import (CSV, token and one-click connect) lowers the cost of moving a catalogue; a separate Shopify bridge exists with a test order paid through a signed webhook, while full browser install/refund acceptance and a WooCommerce connector remain open.
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
| 4 | Complete the operating loop | Extend live acceptance for reconciliation, tax lines and signed period bundles; separately approve and prove anchoring; verify Shopify migration before promising broader platform connectors |
| 5 | Pilot | A small number of real businesses taking real payments with the owner's weekly review; publish what happened, including failures |
