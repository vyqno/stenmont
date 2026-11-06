# ENS feedback

From building on ENSv2 on Sepolia: a registry of subnames under `stenmont.eth`, a resolver per business, agent names under each business, and a payout lock.

## What worked

- **The model is a good fit**: a name owned by a payout account, a finance member limited to one record, an agent name that can edit only its own context record, and a payout lock that is permanent. All of this ran live on Sepolia.
- **Standard resolution works**: names resolve through the normal ENS path to the business account.
- **ENS's own CLI source** was the most reliable documentation.

## Where we got stuck

- **Docs and chain disagree.** The deployed Sepolia contracts are an older build than the repo's main branch. We read the deployed behaviour (CLI source plus the code at the deployed commit) and proved it live.
- **No `createSubname` function.** The docs say to register on the parent's registry; subnames are made with `register()` on that registry.
- **Permissions are per record key, not per name.** A name that needs its own permissions needs its own resolver. This is easy to miss and shapes the whole design.
- **`grantRoles` is disabled in the deployed resolver**; `grantSetterRoles`, `revokeRoles` and `revokeRootRoles` are what work.
- **Reading a record** needs `resolve(name, data)`, not `text()`.
- **Public gateway limits**: the Tenderly Sepolia gateway rate-limits reads from Workers (HTTP 429) and refuses raw transactions. We read through a fallback provider and send through another.
- **A hole we found in our own design**: a registrar wallet with all roles on the parent registry could re-point a name to a new resolver and dodge the payout lock. It must hold only the register role.

## What the docs were missing

- A worked example of subname registry plus per-name resolver plus roles.
- Which contracts are deployed on Sepolia and at which commit.
- Expected rate limits for the public gateway when called from serverless runtimes.

## The improvement with the greatest impact

Keep one deployed reference (addresses, commit and an end-to-end example) that matches the docs. Most of our time went on finding out what was actually deployed.
