# W15 — deployed ENS depth

This is a verified capability inspection slice, not completion of every requested ENS feature. No transaction, role grant, name registration, deployment or funding occurred. API/UI changes below are local until the lead deploys them.

## Actual Sepolia evidence

[Read-only evidence](evidence/ens-depth-sepolia.json) records runtime hashes at block **12076653** and name/role/resolve observations and simulations at block **12076670**. Simulations are `eth_call`, not transactions or persisted changes.

- Business `e2emw4k3tmp.stenmont.eth`: standard UniversalResolver resolution and direct resolver `resolve(name,addr(node))` both returned `0x5373B398C0Ba32904B139C625A6dE5dbBF1Aa0CC`.
- Its owner token role bitmap is zero. An owner-originated `unsafeTransfer` simulation reverted `TransferDisallowed`.
- Finance member `0x7777777777777777777777777777777777777777` has text-role bitmap16 for `stenmont.profile`, zero for `stenmont.payout`. Profile-write simulation succeeded; payout-write simulation reverted `EACUnauthorizedAccountRoles`.
- Registrar root rights on this locked resolver are zero. `linkToRecord` simulation reverted `EACUnauthorizedAccountRoles`.
- `inv-1.e2emw4k3tmp.stenmont.eth` returned zero through direct resolver `resolve`; it does not identify a claim holder.
- Revoked `billing-bot.e2emw4k3tmp.stenmont.eth` has registry status0, zero current owner/resolver and standard resolution `null`. Its old resolver still returns the historic context record directly. Removal from the namespace does not erase historic records.

## What the deployed build supports

| Request | Observed support and boundary |
|---|---|
| Per-record roles | Supported, scoped to a text key or coin type across one resolver instance. Existing finance grants only `stenmont.profile`; each agent's own resolver grants only `agent-context`. Friendly roles do not confer arbitrary invoice, payment, collection-policy or private-Books access. |
| Owner / auditor | Ownership and setter rights are separate. Current owner holds no token transfer privilege. Public records need no auditor write grant; private business data needs separate authentication. No new auditor grant is fabricated. |
| Expiring agent names | Registry expiry controls normal name resolution. Independent direct resolver permissions do not automatically expire. Existing API derives an expired status; explicit revoke removes context rights and unregisters the name. No active agent was allowed to expire during this run, so expiry is source-verified, not a new live expiry proof. |
| Non-transferability | Deployed registry checks token-only `ROLE_CAN_TRANSFER_ADMIN` (`1<<156`), assignable only at registration. Existing creation passes roleBitmap0. Owner transfer denial was simulated on a real business name. No new team-name namespace was created; dedicated team-name UX remains open. |
| Shared record aliasing | Implementation has `linkToNode` / `linkToRecord`, but Stenmont's current resolver grants omit `ROLE_LINK`. Existing locked names cannot acquire it. Linking shares an entire record bundle, including payout; it is not a safe policy-key-only alias. No alias was written. |
| Invoice wildcard → current claim holder | Not configured or supported by the present resolver's stored-record lookup. Claim ownership is on Whitechain, names on Sepolia. A cross-chain verified resolver/gateway design requires separate review; a copied address or stale API field is not this feature. |

The payout lock and registrar-only tier/directory/collections/A2A records are unchanged. No root, link, upgrade or protected setter authority was added.

## New local inspection

`GET /v1/ens/authority?member=<address>` examines only the authenticated business's saved name and resolver. Every RPC read is pinned to one block; an RPC failure returns502 instead of fabricated zero permissions. It reports ownership, expiry, actual bitmaps, resolved payout, alias authority and an explicitly limited invoice-name probe. Ten inspections per merchant per minute cap the RPC work.

The Identity page adds an explicit **Inspect onchain authority** panel. It separates public auditing, profile editing, context editing and token transfer privilege. It never promises that a grant with one friendly label can move money. The panel has not been browser-verified or deployed by this workstream.

Reproduce the read-only report without loading `.env`:

```sh
pnpm --filter @stenmont/scripts exec tsx ens-depth.ts e2emw4k3tmp.stenmont.eth
```

The command has no signer, send path or private-key argument. Existing public RPCs may rate-limit; failure is not evidence of absent permissions.

## Primary sources

- [ENS Permissioned Resolver](https://docs.ens.domains/ensv2/permissioned-resolver/): key-scoped EAC, record bundles, linking and direct `resolve`.
- [Verified deployed resolver sources and ABI](https://sourcify.dev/server/v2/contract/11155111/0x115eb53F0c60696633855F90b138178Fb40b2b2C?fields=sources,metadata,abi), runtime match (not exact metadata match), verified2026-10-01.
- [Verified deployed registry sources and ABI](https://sourcify.dev/server/v2/contract/11155111/0x9BD8a88719068D09ecee662f36C0E3856708366a?fields=sources,metadata,abi), exact runtime/source match, verified2026-10-01. `RegistryRolesLib`, `PermissionedRegistry._update` and `_getSettableRoles` establish transfer constraints.

No third-party contract sources or fonts were vendored.

## Progress and checks (IST, 2026-11-06)

- 18:18 — shared authority tests observed red for the missing module, then3 passed. Shared TypeScript passed.
- 18:19 — pinned inspector tests observed red for the missing module, then2 passed. Actual read-only report recorded block12076670; API TypeScript passed.
- 18:28 — API tenant/error inspection tests plus existing ENS routes17 passed; shared3 passed. Web, scripts and shared typechecks passed. Live simulations and normal resolver readback are recorded above.
- Not run: a full workspace suite, browser inspection of the new panel, new name/role/alias writes, live expiry wait, wildcard claim-holder lifecycle, any deploy or push.
