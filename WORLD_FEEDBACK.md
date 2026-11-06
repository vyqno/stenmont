# World feedback

From integrating World ID (IDKit Proof of Human, in the dashboard and the investor flow) and Agent Pass sign-in (OIDC) as the human approval for large refunds.

## Time to first success

- **IDKit**: a working widget quickly from the docs; about one more hour to the first accepted proof, spent on the verifier's bot protection (below) and on discovering that the simulator needs its Continue button pressed after the proof is "presented".
- **Agent Pass approval**: the sign-in starts and World accepts the request; it still needs one real sign-in by an Orb-verified person, which we have not completed with the simulator.

## What worked

- Staging environment plus the public simulator let us test the full enrolment without a phone.
- The nullifier gave us "one person, one business" with a unique index. A second business by the same person is refused.
- The discovery document was the quickest route to the OIDC endpoints.

## Friction

- **The verify endpoint answered requests from a Worker with a 403 HTML page** when they carried no identifying User-Agent. It looks like an upstream error, not a block. Adding a User-Agent fixed it.
- **The RP signature layout** is not in the docs; the docs name the server signer but we had to read the signature layout from the idkit-server source.
- **PKCE is required** by the OIDC client but the discovery document does not say so. The error arrived as a redirect with `code_challenge must appear exactly once...`.
- **One error for two causes**: the portal's "Check client_id and the exact redirect_uri" message covers a wrong client, a wrong redirect and a wrong environment.
- **The simulator is one fixed person**, so "different people" tests (buyer vs supplier) cannot be fully exercised without real accounts.

## Missing capability

- A way to approve an Agent Pass sign-in in a test environment without an Orb-verified account.

## The improvement with the greatest impact

Publish the RP signature layout and the "PKCE required" note, and make the verify endpoint's bot protection return a clear JSON error. Those three would have saved most of our integration hour.

## Denied path

A second business verified by the same person is refused ("already verified a business") and stays unverified; a cancelled World sign-in leaves the protected refund undone.
