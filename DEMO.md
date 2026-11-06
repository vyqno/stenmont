# Demo shot list (2:00 to 4:00)

Every window is labelled with its party. Run on staging (`app-staging.stenmont.com`, Whitechain Sepolia).

| # | Time | Party | Shot | Proof on screen |
|---|---|---|---|---|
| 1 | 0:00 | Merchant | Example shop: the 10-line integration (`apps/example-store/INTEGRATION.md`), then a cart and the Pay button | Source diff, order "pending" |
| 2 | 0:30 | Customer | Stenmont pay page: one button, a passkey, no crypto words. Returns to the shop; the order turns paid from the signed webhook | Explorer link for the USDT transfer; customer held 0 WBT |
| 3 | 1:00 | Merchant | Dashboard shows Paid. Refund with the passkey. CSV export lists payment and refund | Refunded badge, CSV rows |
| 4 | 1:30 | Merchant + person | Large refund (above 2 USDT on staging): "a person must approve it with World". Approve; then a second attempt that is cancelled and leaves the refund undone | Approval, then denied path |
| 5 | 2:00 | Agent | `scripts/agent-pays.ts`: pays a 0.01 USDT endpoint, then an over-limit request and an unlisted host are refused before signing | Settlement transaction, refusals |
| 6 | 2:30 | Merchant, investor, customer | Sell an invoice at a discount; investor (verified with World) funds with one tap; the customer pays; the investor is paid by the contract | Claim funded, settled |
| 7 | 3:15 | Anyone | `acme.stenmont.eth` resolves to the business; payout lock; agent name `billing-bot.acme.stenmont.eth` | ENS resolution |

Rehearse once with a stopwatch. Shot 6 needs a real World sign-in (an Orb-verified person); shot 4 does too.
