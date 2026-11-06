# Track checklist: the honest audit

Every requirement from [PS.md](../PS.md) (Whitechain, World, ENS), plus what the live ETHGlobal prize pages say, mapped to a status and the exact next action. Last updated 2026-11-06 against the `integration/next` line.

Status words:

- **Proven live**: run on staging against the real chain and services, with an explorer link or a recorded run.
- **Built**: implemented and unit or integration tested; not shown live.
- **Missing**: not done.

"Owner" means an action only the founder can take (push, record, publish, a real person's World sign-in).

## 1. What the live prize pages say that PS.md does not

Fetched on 2026-11-06 from `https://ethglobal.com/events/mumbai/prizes/whitechain`, `/world` and `/ens`. All three loaded.

| Finding | Detail | Our position |
|---|---|---|
| **A fourth Whitechain track, Continuity** ($3,000, 1st $1,500, 2nd $1,500) | "Bring your product to Whitechain": add Whitechain to an existing product during the hackathon. Needs everything in the six common requirements plus **proof of a starting point** (a dated pre-hackathon commit or earlier submission page) and a **"before and during" section in the README**. "Won't place: projects that only repackage something built before the hackathon." | **Not entering.** Stenmont started from an empty repository; the first commit is dated 2026-11-05. The README says so in its "Before and during the hackathon" section. |
| World: a Continuity-only Agent Pass prize ($2,500: 1st $1,500, 2nd $1,000) | Same requirements as the $5,000 Agent Pass track, for Continuity participants only | Not eligible, not entering |
| World: "[Cont] Best Use of IDKit" ($2,500, up to 2 teams of $1,250) | Continuity track only | Not eligible, not entering |
| ENS: "Best Integration of ENSv2 into an Existing Project" ($3,000) | Continuity only, **mainnet only**, an existing project | Not eligible, not entering. Our ENS work is on Sepolia and a new project |
| ENS: a workshop | "ENSv2 - Identity for Apps, Agents & Beyond", Thursday 5 November 2026, 4:00 PM IST, in person | Not a requirement |
| Whitechain, World and ENS qualification lists | Same as PS.md, with no other additions | Covered below |

No other new track or requirement appeared on the three pages.

## 2. ETHGlobal submission rules we also follow

These come from the event's project rules rather than PS.md.

| Rule | Status | Next action |
|---|---|---|
| Start from scratch; no earlier project's code | Proven by history: first commit 2026-11-05 22:05 IST, third-party libraries named in the README | Keep it so; do not import code from other projects |
| Frequent small commits, real timestamps, no squash or history rewrite | Met on this line: about 270 individual commits on 5 and 6 November, no rewritten history | Owner: push regularly so GitHub shows progress; never force-push |
| Open source, public repo | Apache-2.0 `LICENSE` and `NOTICE` present; secrets absent from history | Owner: confirm the repository is public and the working branch is pushed |
| Demo video 4 minutes at most, no speed-up | **Missing**: not recorded | Owner: record with [DEMO.md](../DEMO.md) at real speed |

## 3. Whitechain, the six requirements all tracks share

| # | Requirement | Status | Evidence | Next action |
|---|---|---|---|---|
| 1 | Contracts on Whitechain Sepolia (1874), verified on the explorer | Proven live | README "Deployed contracts", `contracts/deployments/1874.json` (six contracts, all verified) | Re-check the explorer shows "verified" for each before submission |
| 2 | At least one payment in the official USDT in the main flow, explorer link in the README | Proven live | README "Real payments" (lifecycle on the current router, 1.00 USDT store payment, 0.01 USDT agent payment) | None. Keep payments on the current router in the demo |
| 3 | README line on why onchain stablecoin settlement on Whitechain | Done | README "Why onchain stablecoin settlement on Whitechain" | None |
| 4 | Public repo, steady progress, README with setup, architecture, limitations | Built; repo publicity is the owner's | README sections; about 270 commits on 5 and 6 November | Owner: push; check the README commands on a clean clone |
| 5 | Demo video, 2 to 4 minutes, shows each party | **Missing** | Plan in [DEMO.md](../DEMO.md) | Owner: pre-flight, rehearse, record |
| 6 | `WHITECHAIN_FEEDBACK.md` | Done | [WHITECHAIN_FEEDBACK.md](../WHITECHAIN_FEEDBACK.md) | Add anything new found during the recording |

## 4. Operate: Stablecoin Payments for Business

| Requirement | Status | Evidence | Next action |
|---|---|---|---|
| A drop-in piece (widget, SDK, link API or plugin) that a separate demo app adds in about 20 lines | Proven live | SDK and React button; `apps/example-store/INTEGRATION.md` (10 added lines) running at `shop-staging.stenmont.com`; an isolated store built by an AI agent from the Connect prompt took a real 1.00 USDT payment (`docs/INSTALL-ACCEPTANCE.md`) | Show the diff in the video |
| Both views in the demo: the merchant and the paying customer | Proven live | Dashboard and pay page in Playwright runs on staging; customer account page `/account` | Show both in the video; the account page has not been run live in a browser |
| Extra credit: refund | Proven live | Passkey-signed refund on the current router; the dashboard shows Refunded; CSV lists payment and refund | Show in the video |
| Extra credit: renewal | Proven live | Subscription with two renewals and a customer cancel on the current contracts | Optional in the video |
| Extra credit: accountant export | Proven live | Generic and QuickBooks CSV on real data | Show the CSV |
| Idea: payment links and invoices with due dates and reminders | Built (due dates proven live); reminders not shown live | Reminder job sends `invoice.reminder` webhooks (3 days before, due, 3 days after) | Run a reminder against a real due invoice on staging |
| Idea: subscriptions with permit-based pulls and cancel anytime | Proven live | `SubscriptionManager`; customer subscribe page; cancel by the customer, and by the merchant by signature | None |
| Idea: refunds and partial refunds with a record the customer can check | Built; partial refunds covered by tests, customer record on the account page | Refund ledger and `/account` | Run a partial refund and view it on the account page |
| Not a plain transfer, tipping jar, bill splitter, custodial bridge, payroll, escrow or split on its own | Met by design | Router holds no customer funds; invoice, refund, export and renewal logic | None |

## 5. Tokenize: Real World Finance

| Requirement | Status | Evidence | Next action |
|---|---|---|---|
| Transfer rules enforced in the contract (allowlist, restrictions, settlement conditions) | Proven live (contract), with a labelled shortcut | `InvoiceClaim` restricts transfers to allowlisted holders, freezes after settlement, pays the holder from the customer's payment; lifecycle links in the README | Show the explorer in the video |
| A clear issuer, investor or business user and a full lifecycle step | Proven live | Merchant, investor and buyer in the five-step lifecycle: investor paid 0.95, received 1.00; merchant 0.85 plus 0.10; router and claim hold 0.00; buyer record 2 to 3 on-time | Same |
| Allowlisting with a real World proof | Built; not run live as part of the lifecycle | `POST /invest/allow` verifies a World proof first; the lifecycle script bypasses it with the attester key and says so | Owner: run the investor path through the UI once with a World sign-in |
| The dashboard "Sell this invoice" path and the public certificate on a live claim | Built; not run live | `/dashboard/financing`, `/claim/<id>` | List an invoice through the dashboard on staging and open its certificate |
| Default path | Built; not run live | Unit and fork tests; seven-day grace makes a live run impractical | State it in the video notes; no action |
| Not a mint-button token or ownership NFT | Met | Claim token has allowlist, state and payout logic | None |

## 6. Scale: Payments Nobody Notices

| Requirement | Status | Evidence | Next action |
|---|---|---|---|
| A payer flow with zero crypto steps visible, shown in the demo | Proven live | Pay page: one button, a passkey, no crypto words (tested); relay paid the gas; payer held 0 WBT | Show in the video |
| How the business pays the gas | Done | README "How gas works": the merchant's gas tank | None |
| How the relayer gets its WBT | Done | README: a funded wallet with a 0.02 WBT floor; tank is the accounting | State plainly that the tank is operator-set today |
| What stops draining | Proven live | Single-use bound authorisations, simulation first, limits, atomic reservations, a fixed settle race, attack tests, live drain run | None |
| x402 pay-per-request through a facilitator we run | Proven live | `services/facilitator`; 0.01 USDT settled | Show in the video |
| Not a flow where the payer signs a gas transaction, not an AI chat that never pays | Met | Both paths settle real USDT | None |
| Self-serve gas-tank top-up | Missing | `scripts/fund-gas-tank.ts` sets it | Build or state as a limitation (it is stated) |

## 7. World ID Agent Pass

| Requirement | Status | Evidence | Next action |
|---|---|---|---|
| Integrate the official World ID Agent Pass | Built | OIDC sign-in with PKCE; World started a real sign-in transaction | None |
| Complete journey: request, user completion, validated result, protected action | **Built, not proven live** | Backend checks the token (signature, issuer, audience, expiry, nonce, under 5 minutes old); an approved approval is used up once and lets the router's `RefundApproval` be signed for exactly that refund | Owner: complete one real sign-in (or confirm the test environment accepts a mocked identity) and record it |
| A denied, expired or cancelled path where the action does not happen | Built; not shown live | Route tests (`services/api/test/worldRoutes.test.ts`); a denied approval leaves the refund undone | Show the cancel path live in the video |
| Validate in a secure backend, no client secrets exposed | Built | Secrets live in Cloudflare; the client only receives a redirect | None |
| Short integration debrief | Done | [WORLD_FEEDBACK.md](../WORLD_FEEDBACK.md) | Add the time to first success for the completed half once done |
| A meaningful action needing a human layer | Met by design | Refunds above a threshold and agent limits above 100 USDT need a fresh World sign-in | None |

## 8. Best Use of IDKit

| Requirement | Status | Evidence | Next action |
|---|---|---|---|
| IDKit in a functioning app | Proven live | Dashboard "Verify with World ID", World's public simulator, the API verifies the proof with World | Show in the video |
| A supported credential, verified on the server | Proven live | Proof of Human (Unique Human proof); the nullifier is stored under a unique index | None |
| Explain the product event and why the credential is the minimum | Done | README "Why Proof of Human is the minimum credential" | None |
| A successful verification and an alternative path | Proven live | Success, then the same person verifying a second business is refused and stays unverified; cancelled widget handled | Show both |
| Short integration debrief | Done | [WORLD_FEEDBACK.md](../WORLD_FEEDBACK.md) | None |
| "Different people" for buyer and supplier shown with two real identities | Built; not proven live | Covered by tests; the simulator is one fixed person | State it (the README does) |

## 9. Best Use of ENSv2

| Requirement | Status | Evidence | Next action |
|---|---|---|---|
| Built on ENSv2 on Ethereum mainnet or Sepolia | Proven live | Sepolia; `stenmont.eth` with its own subname registry | None |
| ENSv2 central to the product | Met | Business identity, payout lock, team roles, agents and the pay directory all rest on it | Make the video say so |
| Functional demo, no hard-coded values | Proven live | Live acceptance run on staging: reserved label rejected, business name claimed and resolved on Sepolia independently, profile-only finance grant, permanent payout lock, agent name created, resolved and revoked | Re-run the Identity spec before recording |
| A live demo link | Proven live | https://app-staging.stenmont.com (the Identity area is behind sign-in) | Consider a public read-only page that resolves a demo name without sign-in |
| Open source on GitHub | Built; the owner pushes | Apache-2.0 | Owner: confirm public |
| Own subname registry; Enhanced Access Control; per-name permissioned resolver | Proven live | `docs/adr/0004-ens-per-name-resolvers.md`, `plan/05-identity.md` | None |
| Expiring, revocable and permanent subnames; agents as namespaces | Proven live | Agent names with expiry and revocation; payout lock is permanent | None |
| Wildcard resolution; record or namespace aliasing | Missing | Not used | State that we did not use them |
| ENS pay directory (`stenmont.pay`, `.x402`, `.token`, `.refund`, `.limits`) and tier record | Built; **not written to the deployed Sepolia resolver** | `docs/ENS_DIRECTORY.md` | Run it once on Sepolia and the `agent-pays-by-name` script |
| ENS feedback | Done | [ENS_FEEDBACK.md](../ENS_FEEDBACK.md) | None |

## 10. What could not be marked proven, summarised

1. Demo video (not recorded).
2. A completed World Agent Pass journey with a real or accepted identity, and its denied path shown live.
3. Allowlisting an investor through the real World proof (the lifecycle used the attester shortcut).
4. The dashboard "Sell this invoice" flow and public certificate on a live claim.
5. Reminders against a real due invoice, and a partial refund viewed on the customer account page.
6. The ENS pay directory and tier record on the deployed resolver.
7. Public repository status and the push of the working branch (owner).
8. Paying from an existing wallet through the hosted page in a browser, real email delivery and Google sign-in.
