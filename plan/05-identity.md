# Phase 5: Identity (ENSv2 and World)

**Goal:** every business and agent has an ENSv2 name; one person can enrol one business; risky actions need a fresh human approval.
**Tech:** viem (ENSv2-ready), the ENS skills and `ens` CLI, `@worldcoin/idkit` 4.6, World Agent Pass (OIDC).
**Depends on:** Phase 4. Prerequisites 0 for `stenmont.eth` on Sepolia and both World apps.
**Done when:** the demo shows each ENS feature and each World path (success and failure) running against real verification with no hard-coded values.

## Review focus

1. World proof replayed for the same action and person: second enrolment rejected (unique nullifier per action).
2. Approval granted for refund A cannot authorise refund B (params hash mismatch).
3. Approval older than 5 minutes or with an old `auth_time`: rejected; denied or cancelled: the refund does not happen and the audit log says why.
4. Agent subname past its expiry or with a revoked role: its text-record write fails.
5. Business name collision (`acme` already taken): clear error, no partial state.

### Task 5.1: ENSv2 spike, write down the exact calls

**Files:** Create `scripts/spikes/ens-v2.mjs`, notes in `BUILDER-NOTES.md`

- [x] Using the ENS skills and `ens --llms`, plus the Sepolia addresses (ETHRegistrar `0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3`, ETHRegistry `0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4`, UniversalResolver `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, VerifiableFactory `0xda70306c98e97ece36f997a21368e53298572991`, UserRegistry impl `0x9bd8a88719068d09ecee662f36c0e3856708366a`, PermissionedResolver impl `0x115eb53f0c60696633855f90b138178fb40b2b2c`), list the exact function names for: create a subname registry, create a subname, grant a role on one text record, set the resolver, set a text record
- [x] Script resolves `stenmont.eth` with viem against Sepolia and prints the owner and resolver
- [x] Run `node scripts/spikes/ens-v2.mjs` → prints owner equal to `DEPLOYER`. Fill the function list into this phase before Task 5.2

**Findings (what is really deployed on Sepolia, which differs from the contracts-v2 main branch):**
- `stenmont.eth` is owned by the deployer wallet, resolver `0xcE7f94E522d7C5Eedaaf82bb76B80FD6a80eA8D4`, expires 2027-11-05. The Universal Resolver reports ENSv2.
- Create a subname: `register(label, owner, subregistry, resolver, roleBitmap, expires)` on the PARENT's registry (there is no `createSubname`). Create a subname registry: `VerifiableFactory.deployProxy(UserRegistryImpl, salt, initialize([{account, roleBitmap}]))`, then `setSubregistry(tokenId, registry)` on the parent.
- Resolver: `initialize(grants[], calls[])`, setters take a DNS-encoded name: `setText(bytes name, key, value)`, `setAddress(bytes name, coinType, bytes)`. Reads go through `resolve(name, data)`; plain `text()` does not exist. Standard viem `getEnsAddress` and `getEnsText` work.
- Permissions are scoped to a record KEY, not to a name: a text key's resource is `keccak256(key)`. So every name that needs its own permissions needs its own resolver (this matches the prize wording: subnames with their own Permissioned Resolver). Rights are handed out with `grantSetterRoles(setterCall, account)` (plain `grantRoles` is disabled) and taken back with `revokeRoles`. Root rights (admin and edit) apply to every key.
- The lock: give the registrar only the keys it should keep (`grantSetterRoles`), then `revokeRootRoles` of its root rights. After that nobody can change the payout record or hand the right out again. It is permanent by design, and members who should edit the profile are added before the lock.
- Live proof: `scripts/spikes/ens-claim.ts` (13 checks pass on Sepolia: the member edits only the profile record, the lock holds, the name resolves).
- Sepolia gateway note: Tenderly's gateway refuses raw transactions ("request exceeds defined limit"); reads use Tenderly, sends use publicnode.


### Task 5.2: Parent name, subname registry, resolver

**Files:** Create `contracts/script/EnsSetup.s.sol` (or `scripts/ens-setup.mjs` if the CLI route is simpler), `contracts/deployments/11155111.json`

- [x] Deploy a `UserRegistry` for `stenmont.eth` and a `PermissionedResolver`; set the resolver on the name; record addresses
- [x] Verify with viem: `getEnsResolver({name: "stenmont.eth"})` returns the new resolver
- [x] Commit line: `feat: set up stenmont.eth subname registry on Sepolia`

**Done:** `scripts/ens-setup.ts` deployed the subname registry `0xE100C72C3BD9781a7AE4d653E0518b54888A5f0c` for `stenmont.eth`, pointed the name at it, and created a registrar wallet `0x96b8b60c0f93D4a2519f0a3d90c9B7eF555196a9` (key in `.env`, to go to Cloudflare as a secret) with all roles on that registry. Addresses in `contracts/deployments/11155111.json`. The existing parent resolver is kept.


### Task 5.3: Business names (`acme.stenmont.eth`)

**Files:** Create `services/api/src/ens/{names.ts,routes.ts}`, tests
**Produces:** `claimBusinessName(merchantId: string, label: string): Promise<{name: string; txHash: Hex}>`; route `POST /v1/ens/claim-name {label}`; text records `stenmont.payout` (the merchant's passkey account) and `stenmont.profile`.

- [x] Failing tests: valid label creates the subname and sets `stenmont.payout`; taken label returns 409; label with uppercase or spaces returns 400; `getEnsAddress("acme.stenmont.eth")` resolves to the merchant payout
- [x] Run → FAIL; implement; run → PASS (against Sepolia with the test key)
- [x] Commit line: `feat: issue business ENS names`

**Built:** `POST /v1/ens/claim-name {label}` gives a business `label.stenmont.eth`: its own agent registry, its own resolver (address and `stenmont.payout` set to the business's payout account) and the subname owned by that account with no rights. Labels are 3 to 32 lowercase letters, digits and hyphens; platform words are reserved; one name per business; a taken label is a 409 and a chain failure leaves nothing half-made (steps already done onchain are skipped on retry). **Live on staging:** a new business claims a name, it resolves through the standard ENS path to the business account, a repeat is a 409 (1.5 minutes).


### Task 5.4: Roles and the payout lock (Enhanced Access Control)

**Files:** Modify `services/api/src/ens/names.ts`; Create `services/api/src/ens/roles.ts`, tests
**Produces:** `grantFinanceRole(name: string, member: Address): Promise<Hex>` (member may edit only `stenmont.profile`), `lockPayout(name: string): Promise<Hex>` (after locking, `stenmont.payout` cannot change without the owner's role and a delay).

- [x] Failing tests: finance member edits `stenmont.profile` → ok; same member edits `stenmont.payout` → reverts; after `lockPayout`, even the owner's immediate change reverts
- [x] Run → FAIL; implement; run → PASS
- [x] Commit line: `feat: add ENS role delegation and payout lock`

**Built (differs from the sketch, because of what is deployed):** `POST /v1/ens/finance {member}` lets a team member edit only `stenmont.profile`; `POST /v1/ens/lock-payout` permanently takes the registrar's rights over the payout record (it keeps the profile record). After the lock no more members can be added, so add them first. Proven on Sepolia by `scripts/spikes/ens-claim.ts` (13 checks) and by the live API run. The registrar holds only the register role on the `stenmont.eth` registry (it cannot re-point or delete a name); the owner of `stenmont.eth` (the deployer, later a multisig) is the root of trust. The payout lock does not yet require a World approval (Task 5.9).


### Task 5.5: Agents as namespaces

**Files:** Create `services/api/src/ens/agents.ts`, route `POST /v1/ens/agents`, `DELETE /v1/ens/agents/:name`, tests; migration `0006_agents.sql` (`agents(id, merchant_id, ens_subname, address, scopes, daily_limit TEXT, per_tx_limit TEXT, expires_at, status)`)

- [x] Failing tests: creating `billing-bot.acme.stenmont.eth` sets text records `agent-context` and `agent-endpoint[mcp]`; expiry set; the agent may edit only its own `agent-context`; revoke makes the name unusable
- [x] Run → FAIL; implement; run → PASS
- [x] Commit line: `feat: add agent subnames with limits and expiry`

**Built:** `POST /v1/ens/agents` creates `label.<business>.stenmont.eth` for an agent: its own resolver (address, `agent-context`, `agent-endpoint[mcp]`, and a `stenmont.agent.policy` record with its limits and scopes), the name owned by the agent's address, an expiry (1 to 365 days), and the agent's right to edit only its own `agent-context` record. `GET /v1/ens/agents` lists them (an agent past its expiry shows `expired`); `DELETE /v1/ens/agents/:label` removes the agent's right and its name. A daily limit above 100 USDT needs a World approval for exactly those terms (operation `agent_limit`), used once. At most 20 agents per business. Unit tests: 8; the on-chain run on Sepolia is the next check.


### Task 5.6: Resolve the payee from the name

**Files:** Modify `apps/web/app/pay/[id]/page.tsx`, `services/api/src/routes/invoices.ts`

- [x] Failing test: invoice created with `payTo: "acme.stenmont.eth"` resolves the address at creation time; changing the record changes later invoices only; unresolvable name returns 422
- [x] Run → FAIL; implement; run → PASS; the pay page shows the name, not the hex address
- [x] Commit line: `feat: resolve payee through ENS`

**Built (differs from the sketch, for safety):** an invoice can set `payTo` to the business's OWN ENS name, which is resolved through ENS when the invoice is created and becomes the onchain payout; the pay page shows "Paying <name>". `payTo` may also be the business's own payout address. Any other name or address is refused (`payee_not_allowed`), so a stolen API key cannot redirect money; a name that does not resolve is a 422. A later change to the record only affects later invoices. Because the payout comes from ENS, the payout lock makes the destination of every future invoice permanent.


### Task 5.7: World IDKit enrolment (one person, one business)

**Files:** Create `services/api/src/world/{rp.ts,verify.ts,routes.ts}`, `services/api/migrations/0007_world.sql`, `apps/web/app/onboarding/WorldStep.tsx`, tests
**Produces:** `POST /v1/world/rp-signature {action}` → signed request context (server signs with `WORLD_RP_SIGNING_KEY`); `POST /v1/world/verify {action, proof}` → forwards to `https://developer.world.org/api/v4/verify/{WORLD_RP_ID}`, on success inserts `world_enrollments(id, merchant_id, action, nullifier, verified_at, UNIQUE(action, nullifier))`. Follow the installed `world-idkit` skill for the widget and request shape.

- [ ] Failing tests with a mocked verify endpoint: success enrols; replay of the same nullifier for `enrol-business` → 409; upstream failure → 502 and no row; cancelled flow in the UI leaves onboarding blocked with a clear message
- [ ] Run → FAIL; implement; run → PASS; live check with a (mock) proof from World's test mode
- [ ] Commit line: `feat: add World ID business enrolment`

### Task 5.8: Two different humans (anti fake invoices)

**Files:** Modify `services/api/src/routes/invoices.ts`; test

- [ ] Failing test: an invoice whose buyer and supplier merchants share one nullifier is rejected with `same_human`; different humans pass
- [ ] Run → FAIL; implement via `world_enrollments`; run → PASS
- [ ] Commit line: `feat: reject invoices between the same human`

### Task 5.9: Agent Pass step-up for risky actions

**Files:** Create `services/api/src/world/{approvals.ts,oidc.ts}`, routes `POST /v1/approvals`, `GET /v1/approvals/:id`, `GET /auth/world/callback`; migration `0008_approvals.sql` (`approvals(id, merchant_id, operation, params_hash, status, world_sub, auth_time, expires_at)`); modify `routes/refunds.ts` and ENS payout change to require an approved approval
**Produces:** `requireApproval(c, operation: "refund"|"payout_change"|"agent_limit", params: object): Promise<void>` throws `403 approval_required|approval_denied|approval_expired`. The flow: create approval → user completes World sign-in at `https://auth.world.org` → callback validates the ID token (JWKS, issuer, audience, `auth_time` within 5 minutes) → marks approved. Follow the `world-agent-pass` skill.

- [ ] Failing tests: refund above 100 USDT without approval → 403 `approval_required` and no tx; with approval for a different amount → 403; denied → 403 `approval_denied`; expired → 403 `approval_expired`; valid approval → refund proceeds once; reuse → 403
- [ ] Run → FAIL; implement; run → PASS
- [ ] Commit line: `feat: add World Agent Pass step-up approvals`

### Task 5.10: Feedback notes

- [ ] Write the World integration debrief (time to first success, friction, missing docs, top improvement) and ENS feedback into `BUILDER-NOTES.md` as you go; they become files in Phase 8
