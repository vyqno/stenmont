# Demo video plan (target 3:30, hard limits 2:00 to 4:00)

**Rules that can disqualify the entry.** The video must be 2 to 4 minutes. It must be recorded and kept at real speed: no speed-up, no time-lapse, no fast-forward of a wait. Cutting between scenes is fine; accelerating footage is not. Show every party: merchant, customer, investor, agent, and the World path that is denied. Everything runs on staging (`app-staging.stenmont.com`, Whitechain Sepolia 1874) with test tokens. Say "test network, test USDT" once near the start.

**Timing facts this plan depends on** (so nothing in the take has to wait):

- A Whitechain transaction confirms in about a second; the whole six-step financing lifecycle script ran in about 15 seconds on 2026-11-06.
- The chain indexer runs on a one-minute cron, so a paid invoice turns "Paid" in the dashboard and the shop's webhook fires up to a minute after the payment. **Do not wait for it on camera.** Make the payment in the take, cut away to the next scene, and cut back to the already-updated page. A cut is allowed; a sped-up wait is not.
- A brand-new passkey sign-up plus account activation costs gas and is rate limited (5 sign-ups per IP per hour on staging). Do not sign up live; use a business created beforehand.

## Shot list

Time is the running clock of the final video. Each shot lists the party, what is on screen, and the proof the viewer should see. Narration is one sentence per shot; do not read the screen.

| # | Time | Party | On screen | Proof visible |
|---|---|---|---|---|
| 1 | 0:00 to 0:15 | Narrator | Landing page, then the example shop. One sentence: "Stenmont lets a business get paid in USDT on Whitechain with no crypto for the customer, then handles refunds, books, financing and agents. This is the test network." | Title, test-network line |
| 2 | 0:15 to 0:40 | Merchant (developer) | `apps/example-store/INTEGRATION.md` diff (10 added lines), then the dashboard Connect page showing all four checks Passed (reachable, domain, signed webhook, test payment) and the live switch | Diff, four green checks |
| 3 | 0:40 to 1:10 | Customer | `shop-staging.stenmont.com`: add a product under $5, press Pay, land on the Stenmont pay page ("Paying ...", amount, one button, no crypto words), tap, passkey prompt, success, return to the shop. Show the payer's wallet in a second tab at 0 WBT | One tap, passkey, "customer pays no gas", explorer link of the USDT transfer |
| 4 | 1:10 to 1:40 | Merchant | Dashboard: the invoice shows Paid (cut here; the indexer is up to a minute behind). Refund 1.00 USDT with the passkey; badge turns Refunded. Open the CSV export: payment and refund rows | Paid, Refunded badges, CSV rows |
| 5 | 1:40 to 2:00 | Agent | Terminal: `pnpm --filter @stenmont/scripts agent-pays`. The agent pays 0.01 USDT to the shop's x402 endpoint; then an over-limit request (`per_request`) and an unlisted host (`host_not_allowed`) are refused before anything is signed | Settlement transaction link, two refusals |
| 6 | 2:00 to 2:30 | Investor and customer | Terminal: `pnpm --filter @stenmont/scripts tokenization-lifecycle` (about 15 seconds). Say aloud: "the allowlist step in this script is a labelled test shortcut". Then the explorer: claim contract, status Settled, investor +0.05, merchant 0.85 + 0.10, router and claim at 0.00 | Six transaction links, Settled, balances |
| 7 | 2:30 to 2:55 | Merchant + ENS | Dashboard Identity: `acme.stenmont.eth` resolving to the business, a finance member limited to the profile record, the payout lock with its permanence warning, an agent name `billing-bot.acme.stenmont.eth` with its policy record | ENS resolution, record-scoped permission |
| 8 | 2:55 to 3:20 | Merchant + World (success and denied) | Settings, "Verify with World ID": QR, the simulator, "Verified". A second business verified by the same person: "already verified a business", stays unverified | Verified badge, refusal message |
| 9 | 3:20 to 3:40 | Merchant + person (Agent Pass) | A refund above 2 USDT answers "a person must approve it with World". Show the approval link. Complete the sign-in once (approved path), or cancel it (denied path); in the denied path the refund stays undone and the invoice is not Refunded | Approval request, then the invoice unchanged |
| 10 | 3:40 to 3:50 | Narrator | One slide or the README tracks table: contracts verified on the explorer, real USDT links, repo URL. Close | URL, explorer |

Total 3:50 is the ceiling; if the take runs over, drop shot 2's Connect page first, then shorten shot 7. Never speed anything up to fit.

## What is honest to say on camera

- Shot 6 uses the lifecycle script, not the dashboard. It drives the contracts directly with test wallets, and its investor allowlist step uses the attester key instead of a World proof. Say so. The dashboard timeline and the public certificate (`/claim/<id>`) only show claims listed through "Sell this invoice", not this script's.
- Shot 8 uses World's public simulator, which is one fixed identity. That is why the second business is refused.
- Shot 9 needs a World sign-in that the simulator may not complete. See the pre-flight item below. If the approved path cannot be completed, show only the approval request and the cancel path, and say that the approved path was not completed. Do not fake it.
- Anything the viewer sees must be a live action. If a step is shown as a recording, it must be a recording of a real run played at normal speed, labelled as such.

## Pre-flight checklist (the day before, and again 30 minutes before recording)

Staging health (all must answer 200 unless noted):

- [ ] `https://api-staging.stenmont.com/health`, `https://app-staging.stenmont.com/`, `/login`, `/docs`, `/llms.txt`, `https://mcp-staging.stenmont.com/health`, `https://x402-staging.stenmont.com` health, `https://shop-staging.stenmont.com/`
- [ ] `POST https://mcp-staging.stenmont.com/mcp` without a key answers 401 with the `www-authenticate: Bearer resource_metadata=` header
- [ ] Explorer reachable: `https://explorer.testnet.whitechain.io`

Money and gas (check each balance on the explorer; test tokens have no value):

- [ ] Relayer wallet holds at least 0.02 WBT (the floor) plus enough for the take; the facilitator wallet holds WBT
- [ ] Demo payer wallet (the faucet, `0x855F…De11`) holds enough official USDT for every payer in the take: at least 15 USDT. Each new shopper gets 5; reuse an existing payer for the take so the faucet's per-IP limit cannot block you
- [ ] The merchant used in the take has a gas tank balance and a daily cap (Settings shows it)
- [ ] Deployer or lifecycle wallets: the investor wallet holds at least 1.00 USDT, the buyer wallet at least 1.00 USDT, the relayer enough WBT for six transactions. Run `pnpm --filter @stenmont/scripts tokenization-lifecycle -- --dry-run` first: it prints the plan and reads no keys
- [ ] Do not run the lifecycle script for real more often than needed; each run uses the test wallets' balances

Accounts and state to stage beforehand (so nothing is created on camera):

- [ ] A business already created on the recording machine with a real passkey (Touch ID or equivalent) that the browser will offer when asked; signed in; delegation (invoice creation by the relayer) enabled; Connect page shows Ready; the example shop's API key and webhook secret are set in Cloudflare for that business
- [ ] Two paid invoices ready to refund: a 1.00 USDT one for shot 4 and a 3.00 USDT one (above the 2 USDT approval threshold on staging) for shot 9. Pay them an hour earlier so the indexer has caught up. Verify the threshold in `contracts/deployments/1874.json` still reads 2 USDT
- [ ] The business has claimed its ENS name; a finance member limited to the profile record and one agent name already exist; do **not** lock the payout of the demo business unless you mean it (it is permanent)
- [ ] Two businesses ready for shot 8: one not yet verified, and a second one to attempt with the same simulator person. Practise the simulator once: after the proof is "presented" the Continue button must be pressed
- [ ] A browser profile with no extensions, notifications off, a clean bookmarks bar, the window at a normal width, and a second tab ready for the explorer
- [ ] Terminal font large, `.env` present with test keys only; screen-share excludes the `.env` file and any secrets. Never show a private key

World Agent Pass check (do this early):

- [ ] Confirm that the approval sign-in can be completed with whatever World identity is available (World mocks proofs on the test network). If it needs an Orb-verified person, schedule that person for the recording. If it cannot be completed, plan shot 9 as request plus cancel only
- [ ] Confirm the OIDC callback `https://api-staging.stenmont.com/auth/world/callback` is still registered in the World Developer Portal

Rehearsal:

- [ ] Rehearse the whole sequence once with a stopwatch, at real speed, with the recorder running. Note the actual time of each shot and cut the plan to fit under 3:50 without speeding anything up
- [ ] Rehearse each cut-away: the Paid status and the shop's order status must already be updated when you cut back
- [ ] Check the finished file: duration under 4:00, no part sped up, audio clear, every party visible, no secret on screen. Upload and confirm the link opens without sign-in

## After recording

Put the video link in the README and the submission form. Record the real elapsed time of the take in `BUILDER-NOTES.md`.
