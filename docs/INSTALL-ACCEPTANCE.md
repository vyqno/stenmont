# Staging installation acceptance — 2026-11-06

Work ran on `chatgpt-work-2`, descended from `integration/clean`. No push or production action. All payments below are on Whitechain Testnet, chain 1874, using its official test USDT.

## Real browser and agent

- Reused one isolated staging business created with Chromium's virtual authenticator: `m_2ece3e76f5427588` (Clean install 1793961401704).
- Added site `https://install-proof-staging.stenmont.com`. A separate coding agent received its generated prompt and the public documentation, with no credentials or implementation source from the integration. It modified the hackathon's own exported example store; the resulting isolated package is `apps/install-proof`.
- The deployed Connect prompt was checked in Chromium for saved checkout UUIDs and invoice/amount reconciliation. The browser signup, Connect page, pause/resume and site check controls ran. Paused invoice creation returned 403 `payments_paused`; payments were resumed afterward.
- The isolated proof Worker uses a new KV namespace, `stenmont-install-proof-staging-orders`. One additional server API key and one working webhook endpoint were created for this business. A second temporary endpoint was created for the registration-retry check and deactivated afterward. Secrets went directly to staging Worker bindings and were never printed or committed.
- Real checkout for order `b9de74b76b16` redirected to the hosted payment page after 8.2 seconds. [Hosted invoice](https://app-staging.stenmont.com/pay/0xe17c6c37432b86492f12f14be0187c0a23adf281963a7bab4b6ad7685fd1d727).
- Existing funded test payer `0x855Fd4b51Adf6386b7d533F59a47E3016973De11` paid 1.00 test USDT using `scripts/relay-pay.ts`. The relay returned 200; the transaction receipt status was success. Payer WBT before/after was zero. No wallets were funded. [Testnet payment](https://explorer.testnet.whitechain.io/tx/0xa25e6e73e3dcaf747ef99a37fa818572fd78f5252e513b3b28aff514242c3d71).
- This exercised the relay route; paying from an existing wallet through the hosted browser UI was **not run**. Google sign-in, real World verification and real email delivery were **not run**.

## Inspector OAuth

Official MCP Inspector CLI 2.14.0 ran with private, isolated state files. A client was dynamically registered, browser consent approved for this same test business, and the Inspector successfully listed tools and called `list_invoices`. Tools advertised: `list_invoices`, `get_invoice`, `export_payments`, `draft_refund`.

A wrong verifier returned 400 `invalid_grant`; an unregistered redirect returned 400. Disconnecting the client in Settings removed the grant; the next stored-auth-only Inspector call failed with exit 3. Live refund draft creation was **not run**; draft-only behavior remains covered by package tests.

## Failures found and corrected

1. A native Workers fetch was invoked with an object receiver by the MCP tool client. A wrapper preserved its invocation context. The runtime-context regression test failed before the fix and passed afterward; the real Inspector read succeeded after deployment.
2. The generated shop's eight-second timeout abandoned invoice creation before confirmation. A nine-second-confirmation regression failed before extending the bounded wait to 60 seconds and passed afterward; the next real checkout succeeded.

The first shop order `b181e50ef71e` left invoice `0x6afa7aa8e936d566eaf85d8f41b131e22f27975e4aedecff4a114a887a0dcf1f` in `creating`, with an in-progress retry key. A separate diagnostic invoice `0xb500fd67a275d451d0546243fecaf55caaeb5af35a846f2c7172b254df4cce36` is open and unpaid. Neither was paid or manually repaired. Durable recovery for abandoned API invoice creation remains a limitation.

3. Webhook registration originally ignored the saved key. It now replays the same logical creation response for an authenticated business/key/request. A changed request is refused. Three regressions cover replay, request mismatch and business isolation. The real staging retry check returned 201 twice with the same endpoint/secret; a changed destination returned 422. Its temporary endpoint was then deactivated (204), leaving the original endpoint active. GET continues to omit secrets.

## Acceptance status

- Site reachability: passed, HTTP 200.
- Signed webhook probe: passed, HTTP 200 after signature verification.
- Domain TXT: passed after sir added the record; DNS lookup and all four stored checks were confirmed on 2026-11-06 at 16:34 IST.
- Indexed paid invoice and signed-webhook order fulfilment: passed; the real store order page reports **Paid** after delivery.
- Current real-browser result: **Ready**, with each of the four checks marked Passed.
- Part V F2 acceptance gate: passed. Inspector OAuth and the real prompt-install payment/webhook checks are complete.

Required TXT name: `_stenmont.install-proof-staging.stenmont.com`; value: `stenmont-verify=19a639ff77a0a7f80e00c8e8edc77fe7`.

## Verification and deployed versions

`pnpm test`: 1,179 passed (including 15 node:test cases). `pnpm lint`: exit 0, with the pre-existing unused import warning in `e2e/world-enrol.spec.ts`. Web typecheck and Cloudflare build passed. The install package has 37 passing tests. Part V D smoke probes passed 22/22 after every changed staging Worker deployment.

- API: `2cfffab9-1d5c-4c65-ae47-d4bb6cd9b7d3` (migration 0023 applied to staging).
- Web: `7f0a9015-7a8d-40a3-aa0d-0c2e69128fb2`.
- MCP: `bbe35b64-73ee-4c7a-bd17-d0b1bb1d4d5f`.
- Isolated proof shop: `652c5212-03c8-4452-a07f-f68ec5cbed56`.

API, web and MCP were deployed in that order from the clean line. The owner was informed before each deploy. Later prompt/MCP fixes and the isolated shop were deployed individually with the same notice and smoke checks. The normal example store was not deployed.
