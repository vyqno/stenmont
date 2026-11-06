# Wave staging checkpoint — 2026-11-06

Source: chatgpt-work-3 through 9cbe94a. Main repository not pushed.

## Verification actually run

Workspace: 1,636 tests passed — API 1,075; web 254; shared 61; MCP 20;
agent 52; SDK 14; React 3; x402 15; facilitator 31; install-proof 59;
example-store 10; scripts 27 Vitest plus 15 node tests.
Lint exited 0 with one existing unused-import warning. Web typecheck and
Cloudflare bundle passed. Foundry 450 passed before formatting-only changes;
fresh dependency/build check, ten targeted contract tests and formatter passed.
This does not establish 100% contract coverage or a completed security audit.

Staging migrations 0040,0041,0050,0060 and0070 applied. Final versions:

| Service | Version | HTTP probes after deploy |
|---|---|---|
| API |72481fd2-c456-4279-9188-8bb1e55d596c|40/40|
| Web |57be7f43-b2d7-4f48-bc4a-f1e792f97ea8|40/40|
| MCP |2e519ed6-291e-4417-9e70-11390f05790a|40/40|

Receipt recovery is deployed with its journal. A deliberately interrupted
broadcast/receipt recovery has not been exercised live.
The enforced CSP covers object, base and framing restrictions; the broader
script/style/vendor policy is report-only. Do not call that XSS prevention.

## Separate demo shop

Only vyqno/stenmont-demo-shop was authorized for creation and push.
Commit 7c997ed deployed to https://demo-shop-staging.stenmont.com,
Worker version 81ee1200-412e-49a2-b95b-d74e88a2cf98. Independent 32 tests and
typecheck passed. Razorpay test credentials remain owner-configured in
Cloudflare only; no Razorpay payment or provider call has been run.

Created exactly two isolated staging businesses: m_1ec90bb421cce5b2 and
m_6e8e647cb8f588bd. The first is unused after its virtual browser session was
lost; no recovery bypass occurred. The second is retained for acceptance.
No wallet was funded. The known existing payer holds its own test USDT.

The copied Connect prompt was implemented by a separate coding agent. The
site, DNS TXT and signed webhook checks pass: 3/4. Cloudflare TXT was updated
through its UI and independently verified at 1.1.1.1 and 8.8.8.8.

First shop checkout is held as uncertain. Replaying its same order ID directly
against the API created one unpaid 1.00 USDT invoice:
0xaff2d503cf93b0b4d589f9e5e91db942cd14db355b7b8dd8ed6163763ebd6763.
No payment was attempted. The shop must validate and save its binding through
its normal code before payment acceptance can be claimed.

Real MCP Inspector 2.12 completed OAuth consent, tool discovery and an
authenticated list_invoices call for the retained business. The grant was
revoked; another invoice read returned Unauthorized/invalid_grant. Tool
schemas alone remain public. No refund or money-moving tool was called.

## Gates still open

Demo-shop payment/webhook/order/dashboard acceptance; real Razorpay test
checkout; complete staging page-by-page visual acceptance; real provider-backed
agent execution; dashboard financing with World; unsupported ENS resolver
features; router-v2 security/coverage and redeployment approval; live Books
bundle acceptance; real-time demo rehearsal and owner video. Local fixture
coverage and HTTP probes do not close those gates.
