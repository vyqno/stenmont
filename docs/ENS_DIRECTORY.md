# ENS pay directory

A business's ENS name (`label.stenmont.eth`) can say how to pay it. An AI agent given only that name reads the records,
checks them, and pays the endpoint they name, inside its own limits. No URL is hard-coded anywhere.

## The records

Five text records on the business's own resolver. All are written by the platform's registrar. None is ever granted to the
business, a team member or an agent (`BUSINESS_GRANTED_KEYS` in `packages/shared/src/ens.ts` lists the only keys they may
write, and a test proves the directory keys are not in it).

| Key | Value | Where it comes from |
|---|---|---|
| `stenmont.pay` | https pay or checkout address | The business's own words. Published only if its host is a site the business has proved it controls (DNS domain check), or a subdomain of one. |
| `stenmont.x402` | https x402 endpoint (optional) | Same rule as `stenmont.pay`. This is what an agent calls. |
| `stenmont.token` | `eip155:1874/erc20:0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` | Derived from our chain configuration. Never typed by a person. |
| `stenmont.refund` | Short text (at most 280 characters, no line breaks) or an https link on a verified host (optional) | The business's own words, validated. |
| `stenmont.limits` | `{"perInvoice":"2000","unit":"USDT"}` | Derived from the business's verification tier. It follows the tier up and down (hourly job). |

`stenmont.tier` (the trust tier badge) is separate and unchanged.

### Why the business does not write these itself

The registrar is the only account holding a role for these keys, exactly as for `stenmont.tier`. A merchant-editable
`stenmont.refund` was considered. The role model could grant it (`grantSetterRoles` is per key, as for `stenmont.profile`),
but the business's owner is a passkey smart account that holds no resolver rights by design and cannot send the
transaction. So the refund text goes through our API (`POST /v1/ens/directory/publish`), is validated and audited, and the
registrar writes it. The content is the business's; the key is platform-controlled. A reader should treat it as the
business's statement, not as a guarantee.

After the payout lock, the registrar keeps only the keys it was granted beforehand. `lockPayout` now pre-grants the five
directory keys along with the profile and tier keys. **A name whose payout was locked before this change cannot have a
directory published**: the write fails with `chain_error` and an `ens.directory_failed` audit row. This is not worked around.

## Publishing

`POST /v1/ens/directory/publish` (signed-in business, `Idempotency-Key` required):

```json
{ "payUrl": "https://pay.acme.example/checkout", "x402Url": "https://api.acme.example/premium", "refund": "Refunds within 14 days" }
```

Every field is optional. A missing field keeps what is stored, `null` clears it. The answer lists the records written and
anything left out with a reason (`host_not_verified`, `not_https`, `too_long`, `bad_text`, `no_cap`). Only records that
changed are written, in one transaction; repeating a request writes nothing. `GET /v1/ens/directory` shows the saved inputs,
what would be published now and what was last written. Every change writes an audit row (`ens.directory_published`,
`ens.directory_failed`). Once a business has published, the hourly job refreshes the derived records (the cap).

## The agent flow

```
pnpm --filter @stenmont/scripts agent-pays-by-name acme.stenmont.eth [--max-per-request 0.05] [--daily 1.00]
```

1. `resolveBusiness(name, read)` (`@stenmont/agent`) reads the five records through an injected reader. It refuses a bad
   name, a failed lookup, a missing `pay`, `token` or `limits` record, any address that is not plain https (no credentials,
   no port, no IP literal, no private name), a token that is not the official USDT on chain 1874, and a cap that is
   missing, zero or absurd.
2. `agentOptionsFor(business, limits)` lets the agent pay only the host of the business's `stenmont.x402` and never more
   per request than the cap the business itself published, whatever the caller asked for.
3. The agent's usual checks run before anything is signed (per request, per day, host, network, asset).

Nothing in the directory can raise an agent's limits.

## Pay page badge

The public pay view carries `trust: { domain, world, ensName, tier }`: booleans, the public name and a number, nothing
else. The page says "Verified business" only when the domain was proved or a real person is registered through World ID, and
lists exactly the proofs that hold. A public name alone is listed but never counts as verification, and no claim is made about
documents, safety or quality.

## Agent allowance cards

The Identity page shows each agent's USDT sent in about the last 24 hours against its daily limit
(`GET /v1/ens/agents/spend`, read from the token's own `Transfer` events from the agent's address). When the amount cannot be
read the card says so; it never shows zero. "Pause all agents" calls the existing revoke step once per agent: the agent's
right to edit its record is removed and its name is released. To resume, create the agent again.

## What has not been checked

- No directory has been written to the deployed ENSv2 resolver. The record writes use `multicall` of `setText`, the same
  calls the tier badge and agent creation already use; the pre-grant of the new keys in `lockPayout` follows the same
  `grantSetterRoles(textSetter(name, key), registrar)` pattern. None of it has been run against Sepolia.
- Reads with `getEnsText` are documented as working in `plan/05-identity.md`; the new script has not been run.
- The spend lookup (`usdtSentSince`) is untested against the Whitechain RPC, including its log range limits.
  It scans at most 200,000 blocks and reports "unknown" on any error.
