# Phase 9: Make it real (after the core product is complete)

**Goal:** a business that already exists can move onto Stenmont in an afternoon, and its agents keep the books. Built only after Phases 4 to 7 are complete and reviewed. Details in [differentiation.md](differentiation.md).

## Tasks (each gets its own test-first plan when it starts)

- **9.1 Passkey sign-in and business onboarding:** replaces magic links; the passkey is the account; World ID; ENS name; guided import.
- **9.2 Import:** CSV and accounting-tool import of invoices and customers; the "copy this prompt" integration for a store's coding agent.
- **9.3 Books:** a double-entry ledger from onchain events; exports for Tally, Zoho, QuickBooks and Xero; aged receivables; month-end close with the ledger root anchored onchain; soft versus final confirmation states.
- **9.4 Agent interface (Code Mode MCP):** `search()` and `execute()` over a typed SDK in a sandboxed Worker; agents are ENS names with limits (SpendPolicy) and World-approved overrides; bring-your-own-agent.
- **9.5 Reconciliation, collections and close agents:** run on the Agents SDK, propose and never move money alone.
- **9.6 Pay from Tron or Ethereum:** deep link into Whitechain's Portal bridge so a customer holding USDT elsewhere pays without a conversion; WhiteBIT on and off ramp notes.
- **9.7 Treasury:** payout to a Safe multisig; owner and guardian of every contract moved to it.
- **9.8 Real-world tokenization depth:** payer acknowledgement, investor allowlist, order financing in stages, supplier programme.
- **9.9 Independent review:** automated audit skills, then a full review pass by a separate reviewer, before anything goes live.
