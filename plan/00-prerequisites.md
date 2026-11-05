# Phase 0: Prerequisites and spikes

**Goal:** everything the build needs exists, and three risky assumptions are proven before code depends on them.
**Done when:** every box below is ticked, the version checks print the expected values, and the three spike scripts pass.

## Accounts and access

- [x] Domain `stenmont.com` on Cloudflare (registered 2026-11-05)
- [x] `wrangler` logged in (OAuth, all scopes) to the Stenmont account
- [x] Skills installed in `.claude/skills/` (Whitechain, World, ENS, Superpowers)
- [ ] Optional: authorize the `cloudflare-api` MCP (`/mcp` in Claude Code). Not needed for deploys, D1, Queues, secrets or email (wrangler covers them); only for DNS edits and dashboard-only settings
- [x] Workers Paid plan ($5/month) active (Cloudflare dashboard, Billing). Needed for Queues and Durable Objects
- [x] Cloudflare Email Sending enabled for `stenmont.com` (`wrangler email sending enable`; SPF, DKIM and DMARC records resolve)
- [x] Public GitHub repo `vyqno/stenmont` (checked: PUBLIC)
- [ ] Hackathon deadline and demo date written here: ____

## Tools (run once)

- [x] Node 26.13.0 LTS installed with nvm and set as the nvm default. In a shell where `~/.local/bin/node` comes first, run `nvm use 26.13.0`
- [x] pnpm 12.16.1
- [x] Foundry 1.9.0
- [x] ENS CLI 0.1.0 (the ENS skills call it)

## Keys and funds (test only; keys go in `.env`, never in chat)

- [x] Four wallets in `.env` (gitignored): `STENMONT_DEPLOYER`, `STENMONT_RELAYER`, `STENMONT_ATTESTER` (signs World/ENS attestations), `STENMONT_DEMO_PAYER`, each with `_ADDRESS` and `_PRIVATE_KEY`
- [x] WBT from https://faucet.testnet.whitechain.io (GitHub sign-in) to the deployer and relayer wallets (an older test wallet `0xc4b02aE9603D3d9CD5653760dbdF337F6c552c0A` already holds 0.9986 WBT and 75.21 USDT; send some to the new wallets) (funded: deployer 0.3, relayer 0.4)
- [x] Official USDT to `DEMO_PAYER` (faucet, or swap WBT at https://testnet.yetitrade.fi). Check: `cast call 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 "balanceOf(address)(uint256)" $STENMONT_DEMO_PAYER_ADDRESS --rpc-url https://rpc.testnet.whitechain.io` is above 0 (demo payer 30 USDT; deployer 10 USDT)
- [x] Sepolia ETH to `DEPLOYER` (2 ETH)
- [ ] Mint ENS MockUSDC `0x240b0316df57887dbbe58b586508b19e633a14aa` on Sepolia
- [ ] Register `stenmont.eth` on Sepolia (it is already registered on mainnet by the owner wallet; Sepolia is separate): `ens register commit stenmont.eth --owner $STENMONT_DEPLOYER_ADDRESS --chain sepolia`, wait 60 s, `ens register reveal …`
- [ ] World Agent Pass app at https://auth.world.org/portal: name `Stenmont`, redirect `https://app.stenmont.com/auth/world/callback`, client secret (Basic), Orb accepted, Face Auth on → `WORLD_OIDC_CLIENT_ID`, `WORLD_OIDC_CLIENT_SECRET`
- [ ] World IDKit app at https://developer.world.org with actions `enrol-business` and `allow-investor` → `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`

## Spikes (each is a script in `scripts/spikes/`; failure changes the later phase named)

### Task 0.1: USDT accepts EIP-3009 signed off-chain (decides Phase 2)

**Files:** Create `scripts/spikes/usdt-3009.mjs`
**Produces:** a recorded answer: exact `receiveWithAuthorization` signature (bytes vs v,r,s) and the domain.

- [ ] Read the verified USDT contract on the explorer; note the exact `receiveWithAuthorization` and `DOMAIN_SEPARATOR` signatures
- [ ] Script asserts the locally computed EIP-712 domain separator for `{name:"Tether USD", version:"1", chainId:1874, verifyingContract: USDT}` equals the on-chain `DOMAIN_SEPARATOR()`
- [ ] Script signs a `TransferWithAuthorization` of 0.01 USDT from `DEMO_PAYER` to `DEPLOYER` and submits it from `RELAYER`; asserts `DEPLOYER` balance rose by `10000`
- [ ] Run: `node scripts/spikes/usdt-3009.mjs` → prints `PASS domain` and `PASS transfer <txhash>`. Paste the signature into Phase 2 Task 2.2 before starting it

### Task 0.2: the P-256 precompile answers on 1874 (decides Phase 3)

**Files:** Create `scripts/spikes/p256.mjs`

- [ ] Script calls address `0x0000000000000000000000000000000000000100` with a known-valid P-256 test vector (160 bytes: hash, r, s, x, y) via `eth_call`; asserts the return is `0x…01`
- [ ] Run: `node scripts/spikes/p256.mjs` → `PASS precompile`. If `FAIL`, Phase 3 uses OpenZeppelin's pure-Solidity P-256 fallback (more gas, still works); record that here

### Task 0.3: contract verification works on the Whitechain explorer (decides Phase 2 deploy)

**Files:** Create `scripts/spikes/verify/` (a 10-line Foundry project with one contract)

- [ ] Deploy the tiny contract to 1874, then `forge verify-contract <addr> src/Hello.sol:Hello --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ --chain-id 1874`
- [ ] Expected: explorer shows the green "verified" tick. Record the exact flags that worked

## Done when check

```bash
node -v && pnpm -v && forge --version | head -1 && ens --help | head -1 && npx wrangler whoami | head -4
```

Expected: `v26.13.0`, `12.x`, `1.9.0`, ENS help text, the Stenmont account.
