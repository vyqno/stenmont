# Staging tokenization run — 2026-11-06

The dry-run completed first. The live command began under the previous Part V instruction, before sir's revised combined-branch sequence arrived. It had completed when an interrupt was attempted. Do not repeat it without sir's approval.

This used only Whitechain Testnet (1874), the existing funded test wallets and the script's documented attester shortcut. No wallets were topped up. It proves the contract lifecycle, not World sign-in, dashboard listing, timeline or public certificate.

- Face value: 1.00 test USDT; discount 5%; reserve 10%.
- Investor: 4.50 → 4.55 test USDT.
- Merchant payout: 0.00 → 0.95 test USDT.
- Buyer: 6.49 → 5.49 test USDT.
- Final claim state: Settled, 1.00 received and 1.00 paid to holder.
- Router and claim balances at completion: both zero.
- Invoice: `0x095a37f8e9e2dfc7348c922a4fb24e640d50c154f00cd948aeb2da4adf3544e6`.
- A new throwaway merchant signer was generated in memory only; it received no gas or USDT funding. The existing test investor's allowlist entry was renewed using the attester shortcut.

## Transactions

- 1 setCreator: https://explorer.testnet.whitechain.io/tx/0x1802efdc31620266809009177aba84d4c70572c6d13ce7882f47f0e8a47a72c0
- 2 createInvoiceAsCreator: https://explorer.testnet.whitechain.io/tx/0xc1c93b87ed00bd426a3f0171ca3a82f9826430f0af302953d88c0aca3f8d9834
- 3 list: https://explorer.testnet.whitechain.io/tx/0xcc980c3ea3b7962b68744f75a58daf747e52244022ed56e6df6ece60ba041e97
- 4 allow: https://explorer.testnet.whitechain.io/tx/0xafc855154adb2cc99e80a4ea3fe52123cd88e70226f9b442dad224ddda02591c
- 5 fund: https://explorer.testnet.whitechain.io/tx/0x5763b20ce2711bf08c3e42dc1e8d33034606f5bef5aa8f4a44faf0ba47d086fb
- 6 pay: https://explorer.testnet.whitechain.io/tx/0x51450b6f64c8b0f280a1b8e928b84a9a27a3d36b82d585305e95c1c3cb83812b

## Limits

API health returned 200. The public claim API returned 404, as expected for a direct-contract run with no registered merchant/dashboard listing. The certificate and timeline were not proven. The seven-day default path was not run. No real World sign-in, contract deployment or production action occurred.
