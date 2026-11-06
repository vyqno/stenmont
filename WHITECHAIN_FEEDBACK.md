# Whitechain feedback

From building Stenmont on Whitechain Sepolia (chain 1874) with the official USDT.

## What worked

- **Public RPC and explorer** were reliable all through the build; contract verification on the explorer worked from Foundry every time.
- **The official USDT supports both EIP-3009 forms and permit**, and ERC-1271 for smart-account payers. That is what made a gasless, wallet-free payer possible: the payer signs, the relayer pays the gas.
- **The P-256 precompile at `0x100` is live.** Passkey accounts verify WebAuthn signatures onchain at a sensible cost.
- **Safe contracts exist on the chain**, which makes the multisig step straightforward.
- The faucet and test tokens arrived quickly.
- **The public RPC served historical state**, so our fork tests run against the real USDT at a pinned block (12,308,524) without a private archive node. Transactions confirm in about a second: a six-transaction financing lifecycle ran end to end in about 15 seconds.
- **Multicall3 is deployed**, which let us create a customer's smart account and send the first payment in one transaction.
- **Blockscout verification** worked from Foundry for every contract we deployed (six on the current set).
- Chain 1874, the RPC, the explorer and the USDT address matched the prize page every time we re-checked them, which mattered after the move to an OP Stack L2.

## Where we got stuck

- **P-256 precompile**: it was not clear from the docs that it is live. We proved it with a Foundry-made test vector that passes on chain and fails when tampered (our first vector was wrong because Node hashed the input twice).
- **Archive history**: the public RPC works, but one hosted Sepolia endpoint we tried had pruned history, so we kept a second provider for log reads.
- **Reading the USDT implementation** was the only way to learn it accepts both signature forms; this should be documented.

- **Test USDT supply**: every new demo payer needs USDT, so repeated end-to-end runs emptied our faucet wallet. We never mint our own token, because a self-minted token would not count, so we ask for more official test USDT each time.
- **Mainnet USDT**: we could not confirm from the docs whether and when the official USDT reaches Whitechain mainnet. Our README says so instead of assuming it.

## What the docs were missing

- A page listing the live precompiles and system contracts (P-256, Multicall3, Safe) with addresses.
- The USDT token's supported authorisation methods (EIP-3009 `bytes` and `v,r,s` forms, permit, ERC-1271) and its EIP-712 domain.
- The recommended way to give builders testnet USDT in volume. Repeated end-to-end tests drained our faucet wallet.

## Found while making the kit agent-installable

Not Whitechain bugs, but they cost us time and may help other builders: an OAuth-protected MCP server needs an unauthenticated `401` that carries a `resource_metadata` challenge, and a real client (the MCP Inspector) found a bug our tests had not: Cloudflare Workers' native `fetch` fails if it is called with an object as its receiver, so our MCP tool client had to preserve the call context. A regression test now pins it. An AI agent given only our public prompt and docs built a working checkout into a separate store; the first real order failed because the generated shop gave up after eight seconds while invoice creation was still confirming; after the wait was extended a real checkout settled 1.00 test USDT.

## The improvement with the greatest impact

Document the live precompiles and the USDT's authorisation methods in one "building gasless payments" page. It is the difference between a day of probing and ten minutes of reading.
