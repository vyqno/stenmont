# Phase 6: Software pays software (Whitechain Scale, x402)

**Goal:** an AI agent pays a business's API per request in official USDT, settled on Whitechain through our facilitator; a finance agent helps the merchant but cannot move money without a human.
**Tech:** `@x402/core`, `@x402/evm`, `@x402/hono`, `@x402/fetch` (all 2.30), `@modelcontextprotocol/sdk` 1.32, Workers.
**Depends on:** Phases 3 and 5. Verify first that `@x402/evm`'s "exact" scheme can target chain `eip155:1874` with USDT's EIP-3009 domain; if not, write a small custom scheme (Task 6.1 step 1 decides).
**Done when:** an agent pays a metered endpoint, the settlement transaction is on the explorer, and an over-limit request is refused.

## Review focus

1. Facilitator asked to settle the same payment payload twice: second call returns an error, one chain tx.
2. Payment for the wrong amount, wrong `payTo`, wrong asset, or expired: `/verify` returns `isValid: false` with a reason.
3. Agent over its per-request or daily limit: refused client-side before signing.
4. MCP tool `draft_refund` never moves money; it returns a pending approval link.
5. Facilitator wallet low on WBT: `/settle` fails cleanly, with no partial state.

### Task 6.1: x402 facilitator Worker

**Files:** Create `services/facilitator/{package.json,wrangler.jsonc,src/index.ts}`, `services/facilitator/test/facilitator.test.ts`
**Produces:** `GET /supported`, `POST /verify`, `POST /settle` per the x402 facilitator interface; network `eip155:1874`, scheme `exact`, asset = official USDT; settlement calls `receiveWithAuthorization`/`transferWithAuthorization` from the facilitator key (`FACILITATOR_PRIVATE_KEY` Worker secret), reuses the relayer caps.

- [x] Read `@x402/evm` source to see whether chain 1874 and USDT's domain (`Tether USD`, version `1`) are configurable; note the result here
- [x] Failing tests: valid payload verifies; wrong amount `isValid:false`; replayed settle → error and one tx; low-WBT facilitator → `settle` error
- [x] Run → FAIL; implement; run → PASS; deploy to `x402.stenmont.com`
- [x] Commit line: `feat: add x402 facilitator for Whitechain`

### Task 6.2: Merchant middleware and demo API

**Files:** Create `packages/x402/src/index.ts`, `apps/example-store/src/api/premium.ts`, tests
**Produces:** `stenmontPaywall(opts: {price: string; payTo: string /* ENS or address */; facilitatorUrl?: string}): MiddlewareHandler` wrapping `@x402/hono`.

- [x] Failing tests: request without payment → `402` with payment requirements for 1874 and the official USDT; request with a valid `X-PAYMENT` → 200
- [x] Run → FAIL; implement; run → PASS
- [x] Commit line: `feat: add x402 paywall middleware`

### Task 6.3: Agent pay client with limits

**Files:** Create `packages/agent/src/{index,limits}.ts`, tests
**Produces:** `createAgentFetch(opts: {account: Account; maxPerRequest: string; dailyLimit: string; allowedHosts?: string[]}): typeof fetch` using `@x402/fetch`; throws `LimitExceeded` before signing; keeps a daily ledger.

- [x] Failing tests: pays a 0.01 endpoint; refuses 5.00 when `maxPerRequest` is 1.00; refuses the 101st 1.00 payment when `dailyLimit` is 100; refuses a host not in `allowedHosts`
- [x] Run → FAIL; implement; run → PASS
- [x] Live check: agent (ENS name `billing-bot.acme.stenmont.eth`) pays the example store's premium endpoint; open the explorer link; save it in `BUILDER-NOTES.md`
- [x] Commit line: `feat: add agent pay client with spending limits`

**Result (6.1 to 6.3):** facilitator live at `x402-staging.stenmont.com` (own wallet, D1 database, payee allowlist and settle caps); `@stenmont/x402` paywall middleware; `@stenmont/agent` pay client with per-request, daily and host limits; the example shop sells a price quote at 0.01 USDT per call. Live run (`pnpm --filter @stenmont/scripts agent-pays`): an agent paid, the call was settled in one transaction on Whitechain (https://explorer.testnet.whitechain.io/tx/0x2a13cb73752a19224db5378a97108513bebe5f0b35abe851c8177e5dbac61e91, exactly 0.01 USDT from the agent to the shop), an over-limit request and a host that is not allowed were refused before anything was signed.

### Task 6.4: Finance MCP server

**Files:** Create `services/mcp/{package.json,wrangler.jsonc,src/index.ts}`, tests
**Produces:** MCP over streamable HTTP at `mcp.stenmont.com/mcp`; tools `list_invoices(status?)`, `get_invoice(id)`, `draft_refund(invoiceId, amount?)` (returns `{approvalUrl}`; never executes), `export_payments(from, to, format)`; authenticated with the merchant's API key.

- [x] Failing tests: tool list contains exactly those four names; `draft_refund` creates a pending approval and no refund row; wrong key → 401
- [x] Run → FAIL; implement; run → PASS; deploy
- [x] Commit line: `feat: add finance MCP server`
