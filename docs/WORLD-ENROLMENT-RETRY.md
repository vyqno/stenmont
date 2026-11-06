# Merchant World action retry: prepared, not deployed

Deployment is explicitly held until sir reports whether the portal maximum-verifications setting solved the existing action. The deployed action remains `enrol-business`; the prepared code uses `enrol-business-v2`. Investor `allow-investor` is unchanged.

## What the evidence establishes

- The most recent enrolment-refusal audit is 2026-11-07 01:02:57 IST: `invalid_proof` / `integrity_verification_failed`. The affected retained test business has zero enrolments. No later enrolment-success audit was found in the inspected tail.
- `world/verify.ts` forwards that exact code from a parsed upstream World HTTP 4xx rejection, excluding429. Local HTTP200 shape/environment/nullifier checks produce other codes. The route records the refusal and answers422. The raw World response and phone request were not retained, so action consumption cannot be established from this audit.
- Insertion happens only after successful verification. A later proof-environment update or success-audit failure would leave the already inserted enrolment present; it does not explain this integrity-refusal event and missing row. No row is reconstructed from an error or widget message.
- Installed IDKit maps its replay response to Already verified for this action. This is separate from a host-app callback failure; it does not establish a local enrolment.
- The [official v4 verify schema](https://docs.world.org/api-reference/developer-portal/verify) matches the parser's success/results/nullifier fields. The local check rejects any failed credential result and is stricter than top-level success requiring at least one successful result. That mixed-result case could be refused locally, but no captured response demonstrates it here; its local code would be `verification_failed`, not the observed integrity code. Credential-policy handling is not weakened by this patch.

## Prepared change and consequences

The four requested consumers are updated: the merchant World routes, the web World widget, A2A trust, and verification-tier facts. The fifth consumer, `world/samehuman.ts`, also uses the new action so the buyer/supplier comparison remains consistent. Route and integration fixtures cover these dependencies. Generic signature/proof fixtures may still exercise arbitrary historical action strings.

Action nullifiers are scoped to their action. Old rows remain untouched and are not relabelled as new-action proofs. Once this change is deployed, old-action enrolments alone do not satisfy new-action status, tier or trust lookups; a fresh valid new-action enrolment is required. No database migration, account reset, portal action change or live proof is part of preparation.

If the portal limit adjustment solves the old action, keep this prepared change undeployed and decide whether it is still needed. If sir approves the new action, deploy API and web together under the deploy lock, reopen the widget without clearing Brave data, and run a fresh genuine merchant proof. A successful merchant proof still precedes the separate investor proof.

Not run: a real new-action proof, browser E2E for the renamed action, deployment, or recovery of an allegedly consumed proof.
