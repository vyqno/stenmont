# What makes Stenmont different (and what Whitechain actually asked for)

Written 2026-11-06 from Whitechain's docs, its ETHGlobal Mumbai talk "How to Win on Whitechain" (Toma Sadova), press coverage and a competitor scan. Where a source is a vendor's own marketing it is marked.

## What Whitechain asked for

- **Build what real business needs.** The example given is a coffee shop that just needs to accept USDT. Infrastructure that web2 businesses can use counts. They like B2B-to-C products.
- **Four tracks**, $15k each: Operate (checkout, invoices, subscriptions, refunds in USDT), Tokenize (asset lifecycles with rules onchain), Scale (gasless, or an AI agent paying in USDT; hide the blockchain), and Continuity (keep building a product you already have).
- **"Why onchain?"** Every submission needs one line on why stable settlement onchain beats Stripe or a normal rail. They said a product that adds a blockchain where it is not needed is worse, not better.
- **Judging:** the repo is read and checked for real deployments; a 2 to 4 minute demo video; a strict 2 to 3 minute pitch on the day; a feedback page.
- **Builders Program:** up to $300k per project, paid in stablecoins against 3 to 5 milestones, answer in about 14 working days, priority for hackathon finishers, plus BD, legal and DevRel help.
- **Chain facts that matter:** OP Stack L2 on Ethereum, one-second soft confirmation then Ethereum finality, WBT for gas, Portal bridge for USDC, USDT, WBT and ETH from Ethereum and Tron, WhiteBIT exchange distribution, Safe for multisig treasuries. Whitechain's own announced primitives are a DEX, an oracle and a bridge: there is no business payments layer yet. That is the gap.

## Who else is here

| Player | What it does | Where it stops |
|---|---|---|
| Request Network / Request Finance | Open invoice protocol, crypto invoicing, accounting exports | Invoice management; no financing, no payer-side zero-crypto flow |
| Bitwave and similar | Crypto accounting and tax | Books only |
| Centrifuge, Credix, Huma | Tokenized receivables, financing pools | Financing only; the paying and the books are someone else's problem; mostly institutional |
| Stripe and card rails | Familiar checkout | Days to settle, chargebacks, cross-border fees, no programmable financing |

Most products do one third of the loop. Few close it.

## Our angle: one closed loop, enforced onchain, run by agents under human limits

1. **Get paid** with a flow the customer cannot tell is crypto: a passkey, no gas, no wallet (Scale).
2. **Books that close themselves.** Every payment, refund and renewal becomes a journal entry for the accountant (Tally, Zoho, QuickBooks, Xero formats), booked at the right moment: soft confirmation for "paid", Ethereum finality for "settled". A month's ledger can be anchored onchain so an auditor can verify it was not changed.
3. **Get paid early, with the rules in the contract.** An invoice becomes a claim only allowlisted investors can hold; the reserve, default and recourse are enforced. Credit history comes from real payments, not paperwork.
4. **Agents with limits that are enforced, not promised.** A business can use ours or bring its own. Each agent is an ENS name with a role, a spending limit and an expiry; anything above its limit needs a fresh human approval (World ID) that the contract checks.
5. **Identity that ties it together.** The business is an ENS name; one person, one business (World ID); the payout can be locked.

## Why onchain, and not Stripe (the one line we will put in the README)

A card rail cannot do these things: settle in about a second and be final on Ethereum, accept USDT that arrives from Tron or Ethereum without a conversion step, let an investor buy a single invoice with the repayment rules enforced by the contract instead of by a lawyer, or give an AI agent a spending limit that the payment itself refuses to exceed.

## How AI agents help a real business (and how it stays cheap)

- **Reconciliation agent:** matches payments to invoices, flags short or late payments, drafts the reminder, posts the journal entry. Nothing moves money by itself.
- **Collections agent:** drafts and sends reminders (email), proposes a payment plan; a person approves anything that changes terms.
- **Close agent:** at month end, produces the ledger, the aged receivables report and a "books are closed" proof.
- **Financing agent:** proposes which invoices to sell and at what discount; the human signs.
- **Bring your own agent:** any agent can connect over MCP. We use the Code Mode pattern from [Cloudflare's post](https://blog.cloudflare.com/code-mode-mcp/): two tools, `search()` and `execute()`, a fixed footprint of about 1,000 tokens however large the API grows, with the model writing code that runs in a sandbox instead of making many tool calls ([InfoQ](https://infoq.com/news/2026/04/cloudflare-code-mode-mcp-server)). Generated code runs in a sandboxed Worker with its own permissions, reviewed separately.
- **Pay-per-call for agents:** x402, settled on Whitechain through our facilitator.

## How an existing business actually gets onboarded

Nobody starts empty. The path has to be short:
1. **Sign in with a passkey.** No password, no one-time code. The same passkey becomes the business's account.
2. **Verify the person with World ID** (one person, one business), and claim a name (`acme.stenmont.eth`).
3. **Bring the business over:** import open and past invoices from CSV or from the accounting tool, or paste one prompt into the coding agent that already runs their store and it wires the integration in about 20 lines.
4. **Connect an agent** (ours or theirs) with a spending limit, and invite the accountant with a read-only export.
5. **Optionally tokenize:** pick open invoices to sell; a payer acknowledgement and the investor allowlist do the rest.

## What we will not claim

- Not audited. The contracts have extensive tests and automated checks and will get an independent review before any real value; nothing here should hold real money until then.
- Testnet only: the demo data is fake, test tokens have no value.
- Historical invoice import cannot prove payments that happened off-chain; it seeds the books, not the credit score.

## Sources

[Whitechain docs](https://docs.whitechain.io/llms.txt), the ETHGlobal Mumbai talk "How to Win on Whitechain, Tracks and Tips", [press release on the relaunch](https://www.theblock.co/press-releases/whitechain-relaunches-as-w-groups-distribution-first-ethereum-layer-2-412097) (sponsored), [Chainlink on tokenized invoices](https://chain.link/article/tokenized-invoices), [stablecoin invoicing tools compared](https://eco.com/support/en/articles/14796350-stablecoin-invoicing-platforms-2026-compared) (vendor blog), [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode-mcp/). Not available this session: Whitechain's recent posts on X (needs a logged-in session) and a second talk's transcript (the video site rate-limited the fetch).
