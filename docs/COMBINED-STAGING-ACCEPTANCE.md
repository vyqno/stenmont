# Combined staging acceptance — 2026-11-06

Branch: `chatgpt-work-3`, created from `integration/next`. Normal merge `355512b` preserved the latest missing install fix and evidence; no history was rewritten or pushed.

## Checks run

The initial combined suite passed 1,359 tests. A web build exposed a browser-global SSR error in funding help; a real product-page visit exposed the API `store` versus client `shop` mapping error. Each received a failing regression and a fix before acceptance. After cleanup safety and retry tests, the full suite passed **1,399** tests:

| Package | Passed |
|---|---:|
| API | 925 |
| Web | 218 |
| MCP | 17 |
| Agent | 26 |
| Shared | 46 |
| Scripts | 22 + 15 node:test |
| SDK / React / x402 / facilitator / example store / install proof | 130 |

`pnpm lint` and web typecheck passed. Lint retains one existing unused-import warning in `e2e/world-enrol.spec.ts`. The Cloudflare web build passed after the fixes.

## Coordinated staging release

Only migrations **0031** and **0032** were pending and applied; 0023 was already applied. `ACCOUNT_LINK_SECRET` was generated locally with 48 random bytes and piped into the staging secret binding without printing or committing it.

Deployed API, then web, then MCP from this branch. The API-stage run passed 24/26 probes: the two new web pages returned 404 on the old web deployment. After web and MCP, **26/26** passed. A later web-only product mapping correction and the tested cleanup API/store were deployed with notice and repeated probes.

- Initial combined API: `4ffde501-acbd-4f61-a032-e25e6bddd5e2`.
- Initial combined web: `be0a14b7-45a8-488e-be57-cfd0e6c51ac3`; corrected web: `a36af52a-b679-48f7-9dd7-9ee5f0478171`.
- MCP: `96fa6931-a280-4b6e-98ba-92b762759397`.
- Final cleanup API: `eebe3351-deff-4c0a-aac5-8c7f25ade090`; isolated proof store: `61632c51-4eb1-418d-8c7a-14ff0e966da7`.

The probes include the original 22 plus the public store page, `/account`, unauthenticated `/account/summary` (401 with the secret configured) and `/v1/ens/directory` (401 without auth).

## Real browser acceptance

Reused the existing isolated proof business; no new signup or third-party account. Created one store, `clean-install-proof-20261106`, and one active synthetic product/variant priced at 1.00 test USDT, with a “nothing ships” notice.

- Public catalogue → product → add to cart → checkout → hosted pay page: passed.
- “Verified business” badge: passed, with website-control proof and verification level 2. No World proof was invented.
- Without an injected wallet: no wallet option rendered.
- With an isolated EIP-1193 test harness: “Pay with my own wallet” paid from the existing funded test payer. The key stayed in Node and was never sent to page JavaScript; the harness allowed only the configured test asset/router and a 1.00 payment.
- Post-payment receipt and private receipts link appeared. Following the link opened `/account`; the paid invoice appeared after indexing. The access-bearing link/token is not recorded here.

[Browser wallet payment](https://explorer.testnet.whitechain.io/tx/0x918025b8e3038718d216ea2228636c5883c18749f4f5619e1084d53b9878164c), invoice `0xa1dd9d1cb016748f57f03b4c471f7834cf75b5285c719339e4e816487f109dd3`.

No wallet funding or real funds were used. The wallet integration used a test provider harness rather than an installed wallet extension. Real World, Google, KYC and passkey-funded customer payment were not run.

## Cleanup and lifecycle

Cleanup ran through the store's authenticated `POST /maintenance/cleanup` path, not manual database edits. Its first call safely made no changes because the API omitted return URLs; a real store-to-API regression reproduced this and passed after fixing the authenticated invoice view.

The next call returned 200 and changed exactly these records:

| Invoice | Before | After | Creation key |
|---|---|---|---|
| `0xb500fd67a275d451d0546243fecaf55caaeb5af35a846f2c7172b254df4cce36` | open, unpaid | expired | unchanged |
| `0x6afa7aa8e936d566eaf85d8f41b131e22f27975e4aedecff4a114a887a0dcf1f` | creating, unpaid | failed | matching unfinished key released |

Paid proof `0xe17c6c37432b86492f12f14be0187c0a23adf281963a7bab4b6ad7685fd1d727` remains paid for 1.00 test USDT. The new catalogue payment also remains paid. A repeat cleanup returned 200 with no changes/reconciliation. Old order `b181e50ef71e` returns 410; paid order `b9de74b76b16` still says Paid. Fresh Connect checks returned 200 and Ready.

This isolated staging policy expires unpaid invoices after 15 minutes, fails abandoned creation after 10 minutes, and checks every 15 minutes. Chain-paid or financed invoices, active payment submissions and paid markers prevent retirement. Creation release verifies the exact original request fingerprint. Terminal state reconciliation handles lost responses or partial KV writes. The batch is limited to the latest 100 invoices; this is not a general production retention policy.

Expiry closes hosted checkout and preserves audit rows and bindings; it does not claim an onchain cancellation. No contract transactions were sent by cleanup.

The earlier direct-contract lifecycle result is recorded in `TOKENIZATION-STAGING-RUN.md`. After cleanup, `pnpm --filter @stenmont/scripts tokenization-lifecycle --dry-run` passed: nothing sent. No further real run was started; it awaits sir's approval.
