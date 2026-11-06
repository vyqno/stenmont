# V2 staging acceptance

Recorded 2026-11-06 23:54 IST. Whitechain test network1874 only. Acceptance is **partial**: real World and the dashboard investor lifecycle are still held. General invoice creation stays frozen; only the retained isolated acceptance merchant can create v2 invoices.

## Deployment and provenance

All six sources were verified through the Whitechain explorer. Independent RPC readbacks checked owners, guardian, attester, official token,2.00-USDT refund threshold, recorder wiring and all three signature domains. The new subscription manager remains inactive; v1 bindings and obligations stay on their original contracts.

| Contract | Address | Deployment transaction | Block |
|---|---|---|---|
| InvestorRegistry | [0x03b5803bb1b65401f8e7130a044e46b00aa0abd6](https://explorer.testnet.whitechain.io/address/0x03b5803bb1b65401f8e7130a044e46b00aa0abd6) | [receipt](https://explorer.testnet.whitechain.io/tx/0xeb53260991072f3b98333c7db56bd8c26397ccaaae3d51be5fa007b0cdcfdb75) | 12391118 |
| PaymentRouterV2 | [0xda4dfa02b95fd14bfac657535cbcac7f339bd8e6](https://explorer.testnet.whitechain.io/address/0xda4dfa02b95fd14bfac657535cbcac7f339bd8e6) | [receipt](https://explorer.testnet.whitechain.io/tx/0xbcc8acb301a5f95ee1208754b7ad9bacb4ec82b4baf4e7ebd57a3953fc6d1fc5) | 12391120 |
| SubscriptionManager | [0xc14296d91b8a78e4fd4f03acd139312d2607cac2](https://explorer.testnet.whitechain.io/address/0xc14296d91b8a78e4fd4f03acd139312d2607cac2) | [receipt](https://explorer.testnet.whitechain.io/tx/0xf4a0bfde1ebc2a4561631090fe12e43223d6cc69c29b8ae2ffe37ae88206c40c) | 12391123 |
| InvoiceClaimV2 | [0xd994a18962dda95aa23ba2d25ba9cc7c8addaf3d](https://explorer.testnet.whitechain.io/address/0xd994a18962dda95aa23ba2d25ba9cc7c8addaf3d) | [receipt](https://explorer.testnet.whitechain.io/tx/0x96298c840a064a2cfc82022943e1ae2b7bbd4896f978e29b62f9e0226f5fb716) | 12391125 |
| InvoiceAck | [0xfeccfc30714bb3972a5cffe02371f475570aa011](https://explorer.testnet.whitechain.io/address/0xfeccfc30714bb3972a5cffe02371f475570aa011) | [receipt](https://explorer.testnet.whitechain.io/tx/0x0fe16e8a1691c28f36290e623e822dabb0fdd261b03c8c0359b31ccdd9d3ed48) | 12391128 |
| ReputationRegistryV2 | [0xffee131f70576cd8bd7742f1a9e93276d1821e05](https://explorer.testnet.whitechain.io/address/0xffee131f70576cd8bd7742f1a9e93276d1821e05) | [receipt](https://explorer.testnet.whitechain.io/tx/0xc1de55d76eca835d6ec03b8d452f570ec6f250a63f429cdd5ae8ddcfe6e8bc8e) | 12391130 |

Wiring: [setRecorder(address,bool)](https://explorer.testnet.whitechain.io/tx/0xaded068771e32bdc7593e62bae51e46d5e39b50dbd11310c275bc34fe782b796), [setReputation(address)](https://explorer.testnet.whitechain.io/tx/0xca56033aec706655baf3d94bbb79232a13f500834b1302287dba51a04d28bed8).

Actual deployment gas fee: 0.048062130010 test WBT. No USDT transfer or investor grant was part of deployment.

Migration0071 classified17 retired-router and14 current-v1 invoices from successful creation receipts; one failed row had no creation transaction and stayed unassigned. Its guard rejected a changed inventory before any schema change; rollback was read back. One more current-v1 invoice arrived during old-API propagation and was classified by exact invoice/receipt through tested migration0072. No paid amount or status was fabricated.

## Live checks that ran

- Retained merchant signed fresh v2 creator delegation: [receipt](https://explorer.testnet.whitechain.io/tx/0xde4177ad709d49190e5e24638b5d9b536b3afae07e67c2f8e96f9a70985b4cdd).
- Named buyer paid0.098 test USDT on the0.10 invoice; actual contract paid98000/waived2000 base units, statusPaid: [receipt](https://explorer.testnet.whitechain.io/tx/0x3c1591ffdade2c192d5a9cf6763b1ccb5d6c4e86fbdc39cb9a34219c84589dbe). The signed token authorization used validBefore=discountUntil+1.
- Wrong payer and tampered expected payout were both refused with422 before relay submission. Missing named buyer with discount terms was refused with400.
- A real expired discounted authorization was refused with422; payer balance remained2392000 units. Its previously interrupted creation was recovered through the normal receipt-backed indexer: [creation receipt](https://explorer.testnet.whitechain.io/tx/0xb19cee34dd48153d729abcd025086fdf77db01e6a2e084a9b3caa5c9b87e10b1). No duplicate invoice or database-row edit was used.
- Buyer acknowledged an operator-controlled synthetic invoice/test delivery. The indicative quote moved4.80%→3.80%, using one distinct on-time supplier address: [acknowledgement receipt](https://explorer.testnet.whitechain.io/tx/0x213838bf9b657387c61eff531a72dc822ea26b24d5c5f8aa70726fac54c75d70). This was no payment, no legal guarantee and no evidence of independent humans.
- Legacy retired invoice and the retained1.00-USDT demo-shop receipt remained readable on their original routers.
- After each API/web/MCP release phase,40/40 HTTP probes passed. Final Worker version IDs are recorded in the builder checkpoint.

## Not run / held

- Real World enrollment, denied/approved large-refund session and real investor allowlisting require sir.
- The dashboard listing/funding/customer-payment/settlement timeline and public certificate are not yet completed. An acknowledgement and an early-payment discount are separate from financing.
- No default-path live wait, production deployment, multisig change, new-manager activation, LedgerAnchor or main-repository push.
- Natural ENS expiry is not a v2 acceptance claim.

See [the World session run sheet](WORLD-SESSION-RUN-SHEET.md) for the exact human handoff, first-use investor passkey creation and sir-funded account requirement.
