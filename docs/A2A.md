# A2A billing discovery

Stenmont exposes a deliberately bounded A2A 1.0 JSON-RPC subset. Nothing in this interface signs a payment, moves money, sends mail, or creates a payable invoice. A draft is a task artifact that a merchant reviews and enters into the normal invoice flow.

## Protocol verified on 6 November 2026

The [official specification](https://a2a-protocol.org/v1.0.0/specification/) identifies release **1.0.0**; the wire protocol version is **1.0**, without its patch number. The [method mapping](https://a2a-protocol.org/latest/specification/#53-method-mapping-reference) uses `SendMessage`, `GetTask`, `CancelTask`. The earlier `message/send`, `tasks/get`, `tasks/cancel` belong to the older protocol and are not advertised or silently accepted here.

The platform card is `/.well-known/agent-card.json`. Opted-in businesses have `/a2a/{merchantId}/agent-card.json`. Cards declare `supportedInterfaces` with `JSONRPC`, `protocolVersion: "1.0"`, bearer authentication, input/output media types, capabilities and enabled skills. Cards are public descriptions, not authorization. Platform calls target the authenticated business; the tenant-specific endpoint rejects credentials belonging to another business.

Streaming and push notifications are optional in the [capability model](https://a2a-protocol.org/latest/specification/#443-agentcapabilities); both are false here. Tasks complete synchronously. `GetTask` reads the same merchant's unexpired task, and `CancelTask` returns `TaskNotCancelableError` for these terminal tasks. Continuing a completed task is refused. The spec also defines gRPC and HTTP+JSON, task listing, subscriptions and extended cards; this implementation does not advertise those capabilities and does not claim full conformance certification.

[Card signing](https://a2a-protocol.org/latest/specification/#84-agent-card-signing) is optional JWS over RFC 8785 canonical JSON excluding `signatures`. Our cards are currently **unsigned** and omit `signatures`; the separate EIP-712 fact attestation below must never be presented as a signed Agent Card.

## Calls and scopes

POST `/v1/a2a/{merchantId}` with a merchant API key or OAuth bearer, `Content-Type: application/json` and `A2A-Version: 1.0`:

```json
{"jsonrpc":"2.0","id":"request-1","method":"SendMessage","params":{"message":{"messageId":"unique-message-id","role":"ROLE_USER","parts":[{"data":{"skill":"list_catalogue","input":{}}}]}}}
```

`SendMessage` returns `{ "task": ... }` inside the JSON-RPC `result`. `GetTask` and `CancelTask` take `{ "id": "task-id" }` and return a Task or protocol error directly inside `result`/`error`.

| Skill | Permission | Input / output |
| --- | --- | --- |
| `quote` | read | `variantId`, integer `quantity` 1–1000; amount from the merchant's current active catalogue price, indicative and non-payable |
| `create_invoice_draft` | draft | `number`, decimal `amount`, optional `customerEmail` and ISO date `dueDate`; non-payable artifact requiring merchant confirmation |
| `check_invoice_status` | read | `invoiceId`; own invoice status and amounts only |
| `get_pay_link` | read | `invoiceId`; existing own invoice's application payment URL |
| `list_catalogue` | read | empty object; at most 50 active products |

OAuth scopes are checked per skill. API-key scopes are checked here too. Only the merchant's session or an API key with write permission can manage access; OAuth apps cannot change settings. Merchant-selected skill toggles are enforced at call time. Access is off by default. Settings is at `/dashboard/agent-access`, linked from Settings; existing Connected Apps controls revoke individual OAuth grants. Revoke-all disables the interface immediately, including cached cards, without revoking unrelated keys used elsewhere.

Task requests are capped at 16 KiB, task retention for retrieval is seven days and creation is atomically capped at 200 per business per UTC day. Repeated identical message IDs retrieve the original task; changing a message with the same ID is refused. Expired task rows still require a future housekeeping purge; they are not readable through GetTask.

## ENS registrar boundary

`stenmont.a2a` points to the server-generated business card URL. `DIRECTORY_KEYS` remains the original five payment records. `REGISTRAR_KEYS` extends that permission boundary with `stenmont.collections` and `stenmont.a2a`. Business, team and agent accounts never receive a role for either key. The payout-lock transaction reserves these keys for the registrar before dropping root rights.

POST `/v1/agent-access/publish-ens` writes only this business's fixed generated URL through `EnsClient.setTextRecords`, with a publication rate cap. No arbitrary record values or registrar secret leave the server. Existing resolvers locked **before** this new reservation may lack the new setter role; the registrar must verify actual authority before deployment/live publication. A stored transaction records publication, not a current resolver readback. No live Sepolia write has been performed for this implementation.

## Discovery client and network boundary

`discoverAgent(name, {read})` reads only the ENS `stenmont.a2a` text record; `callSkill(agent, skill, input, token, options)` sends a structured current-protocol message. These discovery functions require Node's DNS and HTTPS APIs; browser/Worker callers need a trusted equivalent pinned transport, not ordinary fetch after DNS validation.

The default Node transport resolves **all** addresses on every request, refuses an empty/mixed/private/special-use/IPv6 result, and supplies a validated IPv4 address through the actual HTTPS socket's lookup callback. `family: 4` prevents the alternate-family resolver path. TLS verifies the original hostname, with no pooled agent, proxy or second DNS lookup. All redirects fail closed, including public redirects. HTTPS port 443 only; credentials, IP literals (including URL-normalized encoded forms), private suffixes and cross-origin card-to-RPC endpoints are refused. Bodies are bounded while streaming, requests time out after 10 seconds and card schema/protocol/skills are validated. An injected `request` is a **trusted transport** and must honor the supplied addresses and original-host TLS checks; passing generic fetch would invalidate the protection.

Cards and skills remain untrusted data. A discovered name does not establish which merchant's bearer may be sent: supply only a credential intentionally issued for that business/server. The trust signer must be pinned separately as described below.

## Signed fact observations

GET `/a2a/{merchantId}/trust` returns a five-minute EIP-712 observation only when all facts exist: active opted-in merchant, current ENS payout resolution equal to its payout account, fresh DNS TXT control proof, and a stored World enrollment **with original proof environment recorded**. It contains the recorded World verification time; it does not claim a fresh World proof. Staging/simulator provenance remains explicit in the signed environment string. Historical enrollment rows have null provenance and are refused; changing current environment configuration cannot relabel them.

`businessTrustData` and `verifyBusinessTrust` in `@stenmont/shared` define and verify the signature. Verification requires the caller's **independently trusted signer address**, expected name, full environment string, current time and maximum five-minute lifetime. Do not trust the response's `signer` merely because it is returned. The signer is a platform fact attester, not World itself. No nullifier, raw World proof, safe-business claim or KYC claim is exposed.

A dedicated `A2A_ATTESTER_PRIVATE_KEY` secret is needed (0x-prefixed 32-byte secp256k1 private key, managed only in the environment). No secret is committed. Newly completed World enrollments store proof environment; old proofs require an authoritative provenance decision or fresh enrollment by the lead, never a guessed backfill.

## Rehearsal and deployment

`pnpm --filter @stenmont/scripts exec tsx a2a-demo.ts label.stenmont.eth` is no-network dry run. Add `--discover` to read ENS/card; add `--call` as well to call only `list_catalogue`, taking the bearer from `STENMONT_A2A_TOKEN` in the environment. This script never pays. These network modes have not been run live.

Apply migration **0060** before deploying the API, then deploy web. Configure the dedicated signing secret if fact observations are wanted. The lead still owns ENS publication/readback, World proof provenance, browser verification, actual signer distribution and all staging deployment. Local tests are not live proof; track-checklist live marks remain pending.
