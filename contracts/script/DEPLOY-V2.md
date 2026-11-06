# V2 staging deployment procedure

Preparation only. No broadcast has been run by this agent. M-2 remains unchanged on chain: the API requires a named buyer for discount invoices and the web signs exactly `discountUntil + 1`.

Run only from the integrated, tested tree. Keep `INVOICE_CREATION_PAUSED=yes` until acceptance; v1 payment/refund/claim/subscription paths stay active. Snapshot the public deployment manifest, indexer cursors, outstanding obligations and binding names; never export secrets.

The lead privately injects `STENMONT_DEPLOYER_PRIVATE_KEY` into the process environment. Public configuration names: `WHITECHAIN_RPC`, `USDT_ADDRESS`, `STENMONT_DEPLOYER_ADDRESS`, `STENMONT_GUARDIAN_ADDRESS`, `STENMONT_ATTESTER_ADDRESS`, `REFUND_APPROVAL_THRESHOLD`. Owner must be the signing deployer to wire reputation. Review guardian/attester explicitly. Threshold must be 2,000,000 base units (2 test USDT), matching the API. No key values in CLI arguments, logs, repository files or chat; no shell tracing or verbose secret-bearing traces.

## Checks and simulation

```sh
forge test --match-path test/script/DeployV2.t.sol
forge fmt --check script/DeployV2.s.sol test/script/DeployV2.t.sol
forge script script/DeployV2.s.sol:DeployV2 --rpc-url "$WHITECHAIN_RPC" --slow
```

The last command omits `--broadcast` and only simulates. The lead must run it; this agent did not read the private environment or run a live RPC simulation. Guards refuse chain other than1874, unofficial/missing-code USDT, zero roles, signer/owner mismatch or threshold mismatch before broadcasting. Review gas, all eight simulated transactions and returned public addresses. CREATE addresses derive from the signer's starting nonce and are asserted; no other transaction may consume a nonce before the approved broadcast. Re-simulate after any change.

Order: fresh InvestorRegistry, PaymentRouterV2, fresh SubscriptionManager, InvoiceClaimV2, InvoiceAck, ReputationRegistryV2, reputation recorder grant, router reputation binding. No LedgerAnchor, investor allowlist, merchant delegation or token transfer occurs.

## Lead-only broadcast and readbacks

After announcing the first transaction, the lead may add `--broadcast --slow` to the reviewed command. Never rerun blindly after partial failure: inspect each actual receipt and consumed nonce first.

For each creation collect successful receipt status, transaction hash, contract address and actual deployment block from RPC. Simulation block numbers are not deployment evidence. Review/sanitize the Foundry broadcast artifact before publishing anything. Independently read owner/guardian/attester, router threshold/USDT/reputation, claim router/registry/USDT, ack router, reputation recorder and manager owner/guardian/USDT. Recompute EIP-712 domains (router/claim v2, ack v1); verify all six contract sources on the Whitechain explorer with exact compiler settings.

Append the new versioned set to the deployment manifest, retaining v1 forever. New binding names: `ROUTER_V2_ADDRESS`, `ROUTER_V2_DEPLOY_BLOCK`, `INVOICE_CLAIM_V2_ADDRESS`, `INVOICE_CLAIM_V2_DEPLOY_BLOCK`, `INVESTOR_REGISTRY_V2_ADDRESS`, `REPUTATION_REGISTRY_V2_ADDRESS`, `INVOICE_ACK_ADDRESS`. Keep `SUBSCRIPTION_MANAGER_ADDRESS` on v1; the fresh manager stays unactivated until independent per-agreement provenance exists. Keep `INVOICE_DEFAULT_VERSION` on v1 until acceptance. Start each new indexer at its actual deployment block, retaining v1 cursors and chain/address/tx/log-index deduplication.

Fresh registry needs fresh normal World investor approval; old grants are not inferred. Each existing merchant authorizes the new SetCreator domain on `/dashboard/invoices` → **Authorize router v2**. No blanket allowlists or v1 signature reuse.

## Acceptance and rollback

Run the complete security-review live regression before opening creation: v1 obligations; v2 checkout/partial payment; named buyer/wrong buyer; early discount/deadline rejection; tampered payout with unchanged balances; acknowledgement lowering an advisory quote; refund/World approval; financing list/fund/pay/settle; subscriptions and storefront checkout. Default remains a fork-test claim until actually proven live. Web paths: `/dashboard/invoices`, `/pay/<id>`, `/invest/<invoiceId>`, `/dashboard/financing`, `/claim/<id>`. World investor approval begins on the investor page; refund approval remains on the invoice Refund action. Real World sign-in requires sir.

On failure keep creation stopped and restore prior creation defaults/bindings. Preserve v2 obligations, repayment/refund access and all data. Immutable contracts cannot be repaired by changing an address: pause/abandon a broken new set through the reviewed owner/guardian process. Never reset token nonces, redirect a funded claim, delete old deployments or replay old signatures.

The browser build additionally requires public reviewed deployment bindings `NEXT_PUBLIC_ROUTER_V2_ADDRESS` and `NEXT_PUBLIC_INVOICE_ACK_ADDRESS` at Next build time. These are public addresses, never secrets. Missing/mismatched bindings fail closed for new v2 controls; existing reviewed v1 routes remain payable. Before money or acceptance signing the browser reads invoice terms directly from the fixed Whitechain RPC at the reviewed router, rejects API router/payout/immutable-term tampering, refreshes paid/hook state and requires another review if dynamic payment details changed. An available ENS address is independently compared on Sepolia; unresolved names are not promoted to verified identity. Contract provenance alone is not proof of a merchant’s identity or legal ownership.
