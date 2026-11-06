# Customers and businesses use passkey smart accounts

Status: accepted

## Context
Customers must pay without a wallet, a seed phrase or gas; businesses need to sign without handling keys.

## Decision
Each person's account is a smart contract whose owner is a WebAuthn P-256 key (a passkey). The account validates signatures through ERC-1271, which the USDT token supports. A factory deploys accounts deterministically; the first payment creates the account in the same transaction.

## Consequences
No seed phrase and no extension. The cost: no recovery yet (a second passkey is planned), the account has no execute function, and it relies on the chain's P-256 precompile.
