# Wave 1 W5 progress

- 17:51 IST: Added IPv4-pinned HTTPS A2A discovery and bounded current-protocol calls; targeted client tests: 24 passed; agent typecheck passed. IPv6 and redirects deliberately fail closed.

- 17:54 IST: Added opt-in merchant A2A cards, synchronous tasks, isolated read/draft skills, atomic task cap, idempotency and OAuth/API-key skill scopes; migration 0060 is local only. Targeted API tests: 8 passed; typecheck passed.

- 17:56 IST: Added registrar-only A2A directory key and short-lived EIP-712 fact observations. Domain DNS and ENS payout are checked on request; old World enrollments without stored proof environment cannot be attested. Tamper/expiry vectors and registrar grant tests pass; no live ENS or World action run.

- 18:00 IST: Added Agent access settings with skills, permission labels, ENS publication state and revoke-all; linked existing OAuth disconnect controls. Added no-network A2A demo and current-spec documentation. Final targeted checks: agent 26, API 72, shared 9, web 1 passed; agent/shared/API/scripts typechecks and web typecheck passed. Full workspace suite is deferred to the lead integration run as directed.
