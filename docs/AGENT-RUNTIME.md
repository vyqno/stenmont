# Finance assistant runtime

Local implementation; provider calls tested with injected fixtures only. No live Gemini, Anthropic or OpenAI response has been verified. Browser and staging evidence remain pending.

## Boundary and API

`AGENT_ENABLED=yes` enables authenticated `/v1/agent/*` routes. Missing or any other value disables them. Migration `0050_agent_runtime.sql` creates conversations, messages, sealed provider keys, result references and usage ledger. No contract or deployment configuration changes are required.

The dashboard is `/dashboard/agent`. Create a conversation with its explicit tool allowlist; send messages with `POST /v1/agent/conversations/:id/messages`. SSE events are `tool`, `draft`, `message`, `done`, and `error`. A reply is emitted after each completed provider response; this is not provider token-by-token streaming. Reopen history through `GET /v1/agent/conversations/:id`. The usage route is `GET /v1/agent/usage`.

The shared module `services/mcp/src/capabilities.ts` supplies the four existing MCP tool definitions and implementations. Chat executes only its read capabilities: `list_invoices`, `get_invoice`, and `export_payments`. Its `draft_refund` produces a proposal and an Invoices dashboard link, without calling the refund API. The merchant must manually prepare and confirm the refund there with a passkey; large refunds keep the existing World gate. There is no write/send/execute capability in chat. Collections extensions belong to the collections workstream and are not enabled here.

## Providers and credentials

Default: Gemini with server secret `GEMINI_API_KEY`. Anthropic and OpenAI use merchant-supplied keys. A key can also override Gemini for that merchant. `POST /v1/agent/keys` performs a bounded 32-output-token validation call before storing a key. This is a real billable call when used outside tests. Validation is rate/token limited. `DELETE /v1/agent/keys/:provider` removes a saved key.

`AGENT_KEY_SECRET` must be a privately generated random secret of at least 32 characters (recommended: 32 random bytes encoded as 64 hex characters). The lead generates/sets it; no value is included here. The existing AES-GCM/HKDF seal helper binds `agent-key/v1`, merchant id and provider as authenticated data. Copying ciphertext across merchants or providers cannot open it. Plaintext keys are neither returned nor logged. Credentials go in headers to fixed HTTPS vendor endpoints, never a model-chosen URL, and redirects are refused. Provider error bodies are discarded. Keys remain in request memory only while needed; JavaScript cannot guarantee memory zeroization. Rotating the sealing secret makes existing ciphertext unreadable and requires merchants to save keys again.

Primary documentation read on 2026-11-06:

- [Gemini 3.5 Flash-Lite model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite): stable `gemini-3.5-flash-lite`. [GenerateContent API](https://ai.google.dev/api/generate-content): `/v1beta/models/{model}:generateContent`, `systemInstruction`, `contents`, `generationConfig.maxOutputTokens`. JSON text envelope, no native function-call signature handling.
- [Gemini 2.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash): deprecated and limited to existing users, so not the default.
- [Anthropic Messages](https://platform.claude.com/docs/en/api/messages): `/v1/messages`, model `claude-haiku-5-5`, system and messages, bounded `max_tokens`, API version header `2023-06-01`.
- [OpenAI GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini): snapshot `gpt-5.4-mini-2026-03-17`, Chat Completions supported. Adapter uses `/v1/chat/completions`, JSON response format, `max_completion_tokens`. Earlier GPT-4.1 mini and GPT-5 mini pages are currently labelled deprecated.

Request/response fixtures verify these shapes and fail closed on missing output. Account/model access and actual provider acceptance still require live verification. Model outputs use a single JSON text envelope (`text` or `tool` + `arguments`); a malformed response stops the turn.

## Limits, context and estimates

One atomic SQL `INSERT … SELECT … WHERE` reserves all caps in the same statement, including pending holds: 50,000 tokens per UTC day, 250,000 per UTC month, 20,000 lifetime per conversation, ten provider/validation requests per fixed UTC minute per merchant. Concurrent turns in a conversation are refused with `conversation_busy`. Reservations settle using a conditional pending-to-settled update; repeated settlement cannot double charge. Failed upstream calls charge their full reservation because the provider may already have billed them. `usage_limit_reached` stops the tool loop before another provider call. These are application token caps, not a provider dollar spending guarantee; set provider billing controls separately.

Prompt counts use UTF-8 bytes as a conservative token estimate, plus output budget. Successful provider usage metadata replaces the reserved estimate when valid and within the hold. Missing or anomalous metadata conservatively consumes the hold. Output is capped at 1,024 tokens and a turn at three calls. History rolls down at approximately 70% of the local 8 KB context budget (5.6 KB recent history). The rolling digest contains explicitly tainted excerpts, not a semantic summary; it can lose earlier facts. The stable system prefix is reused; no explicit cache API is configured. Tool results are tainted JSON data, truncated to 1,600 characters in context, with server-stored references; `get_result` reads 1,200-character pages scoped to the owning conversation. Stored results over 200,000 characters are refused. Results are initially buffered, so this is not an unbounded-export solution.

The usage meter labels costs as conservative estimates: every charged token is priced at the model's standard output rate, without input/free-tier/cache discounts. Rates per million tokens: Gemini $2.50, Haiku $0.50 (our context stays below its 100K tier), OpenAI $4.50. Sources: [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini). These are snapshots, not live quotes or invoices.

## Threat model and remaining work

Invoice descriptions, CSV, tool output and stored conversation text are untrusted. They are serialized inside data envelopes with taint labels, never promoted into the stable system instruction. Server allowlists, strict argument schemas and tenant-scoped internal API requests enforce authority independently of model obedience. Prompt injection can still distort an answer or propose an unwanted draft; it cannot enable a disabled tool, choose an outbound URL, read another merchant's result, or execute a money movement. The UI renders plain text, without HTML or Markdown execution.

Tests cover hostile instruction text inside an invoice, disabled refund escalation, unsupported send tools, enabled refund proposals leaving refund requests empty, merchant/provider seal isolation, cross-tenant history/results, simultaneous message admission, reservation races and settle-once behavior. Fixtures demonstrate enforcement, not a guarantee that a live model will ignore malicious prose.

Known limits: a Worker crash can leave a conversation busy and its reservation pending; it fails closed, but needs an operator recovery/reconciliation workflow before broad use. Retention/deletion and total conversation/result storage quotas are not implemented. Provider response bodies and exports are buffered before their length check. History reads are limited, and draft proposal events are not persisted in transcript history. The 20K conversation cap requires starting another conversation when exhausted. No live provider call, browser screenshot, deployment, or production readiness claim is made.

Before staging: apply migration 0050 in numeric migration order; privately set `GEMINI_API_KEY`, `AGENT_KEY_SECRET`, and `AGENT_ENABLED=yes` only after the lead's review; add Agent to dashboard navigation; integrate the shared MCP extraction with collections additions; verify the new semantic `text-on-brand` foreground is present. Then prove chat, caps, history, BYOK deletion and draft review in a real browser with a real provider under a spending cap.
