# Whitechain: ETHGlobal Mumbai 2026

Tracks: **Operate**, **Tokenize**, **Scale**

Prize page: [https://ethglobal.com/events/mumbai/prizes/whitechain](https://ethglobal.com/events/mumbai/prizes/whitechain)

---

## 💳 Operate · Stablecoin Payments for Business ($5,000)

1st $2,500 · 2nd $1,500 · 3rd $1,000

Give a business everything it needs to get paid in USDT on Whitechain, from the first checkout to what happens after it. Build a payment flow a real merchant could plug into their app or store, and show it working end to end with test stablecoins on Whitechain. It is plain EVM, so use any tooling you like.

**Ideas to start from**

- A drop in checkout for online stores with order webhooks and an onchain receipt
- Payment links and invoices for remote studios, contractors and cross-border teams billing global clients, with due dates and reminders
- Subscriptions and recurring billing with permit based pulls and cancel anytime
- Refunds and partial refunds a merchant issues in one click, with a record the customer can check

**What we want to see**

- A drop in piece, widget, SDK, payment link API or plugin that a separate demo app adds in about 20 lines
- Both views in the demo, the merchant and the paying customer
- Extra credit if your flow goes past the first payment, like a refund, a renewal or an export the accountant can use

**Won't place.** A pay button that sends a plain transfer, tipping jars, bill splitters, or custodial bridges into a local currency token. Payroll, escrow and revenue splits on their own.

---

## 🏦 Tokenize · Real World Finance on Whitechain ($4,000)

1st $2,500 · 2nd $1,500

Model real-world asset (RWA) lifecycles and compliance logic onchain. Build an issuance, settlement or lifecycle flow for a real world asset on Whitechain, where every payment happens in USDT, and show it working end to end with test stablecoins.

**Ideas to start from**

- Tokenized bonds or notes with an investor allowlist, coupon payments in USDT and repayment at maturity
- Invoice financing where a business tokenizes an invoice, a buyer funds it at a discount and settlement happens automatically on the due date
- Repo or short term lending agreements with delivery versus payment, where the asset and the stablecoin move in one transaction
- Trade finance flows where importer, exporter and bank each confirm their step before funds are released

**What we want to see**

- Real transfer rules enforced in the contract, such as allowlists, transfer restrictions, maturity or settlement conditions, not just a token with a UI on top
- A clear issuer, investor or business user and at least one full lifecycle step in the demo, from issuance to payment or settlement

**Won't place.** A token with a mint button and no rules, or ownership NFTs where nothing is enforced onchain.

Paying an invoice belongs in Operate. Financing or selling an invoice belongs in Tokenize.

---

## ⚡ Scale · Payments Nobody Notices ($3,000)

1st $2,000 · 2nd $1,000

Businesses scale when their customers never have to learn crypto, and when software can pay software. Build a payment flow on Whitechain where the payer, a person or an AI agent, pays in stablecoins without holding WBT for gas, writing down a seed phrase or knowing what chain they are on.

**Ideas to start from**

- Gasless checkout where the merchant covers gas, using permit or transferWithAuthorization (EIP 3009) and your own relayer
- Checkout with an embedded wallet or smart account from any provider that supports Whitechain Sepolia (chain ID 1874)
- Pay per request APIs where an AI agent pays a business in USDT over x402, settled on Whitechain through a facilitator you run

**What we want to see**

- A payer flow with zero crypto steps visible, shown in the demo
- How the business side pays for the gas, how your relayer gets its WBT, and what stops someone from draining it

**Won't place.** Flows where the payer still signs a transaction that costs them gas, or AI chats that never actually pay anyone.

---

## Qualification Requirements (all three tracks)

1. Contracts deployed on Whitechain Sepolia (chain ID 1874) and verified on the Whitechain explorer
2. At least one payment in USDT (0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7) settled on Whitechain in your main flow, with the explorer link in your README. Payments in a test token you minted yourself won't count
3. A line in your README on why this flow needs onchain stablecoin settlement on Whitechain and what a regular payment rail couldn't do here
4. A public GitHub repo that shows steady progress through the hackathon rather than one big upload at the end, with a README that explains setup, architecture and current limitations
5. A demo video of 2 to 4 minutes that shows each party involved
6. A WHITECHAIN_[FEEDBACK.md](http://FEEDBACK.md) in your repo, a few honest lines on what worked, where you got stuck and what our docs were missing

**Good to know before you build.** Test tokens (WBT, USDT) have no monetary value. Prizes are paid by ETHGlobal in USDC under standard event eligibility rules.




# World: ETHGlobal Mumbai 2026

Tracks: **World ID Agent Pass**, **Best Use of IDKit**

Prize page: https://ethglobal.com/events/mumbai/prizes/world

---

## 🚀 World ID Agent Pass ($5,000)

1st $2,500 · 2nd $1,500 · 3rd $1,000

We are mocking proofs now, so you don't need sandbox app anymore!

Build an application using World ID Agent Pass. We are especially interested in agentic products, but any compelling use case is eligible.

Show what becomes possible when an application can ask a person to authenticate or complete a fresh verification at the moment.

Strong submissions will show a meaningful action that needs a human identity or approval layer, not simply a login screen added to an existing product.

NOTE: Proofs are using fake identities, DO NOT rely in them for production

### Qualification Requirements

- Integrate with the official World ID Agent Pass.
- Demonstrate the complete journey: identity or verification request, user completion, validated result, and the protected application or agent action.
- Demonstrate a denied, expired, cancelled, or otherwise unsuccessful path where the protected action does not occur.
- Validate identity results in a secure backend; do not expose client secrets or treat an unvalidated client response as authorization.
- Include a short integration debrief/feedback: time to first success, friction encountered, missing capability or documentation, and the one improvement with the greatest impact.

---

## 🪪 Best Use of IDKit ($2,500)

Up to 2 teams will receive $1,250

Build a product that uses IDKit to solve a real trust moment: an event where a product needs to know something meaningful about a person before it grants access, completes an action, or changes a user's experience.

Use the credential that is proportionate to your use case—such as Proof of Human, Passport/NFC, or Selfie Check (Now live with Sybil score). We are not rewarding the most credentials used. We are rewarding the best decision about which credential is needed, why it is needed, and how it improves a real product experience.

Strong examples could include fair access to a scarce benefit, a privacy-preserving eligibility check, recovery or protection of an important account action, or a workflow that becomes safer or simpler because it can verify the right level of human trust.

### Qualification Requirements

- Integrate IDKit in a functioning application, mini app, or onchain flow.
- Use at least one supported World ID credential and verify the result on the server or onchain as appropriate.
- Clearly explain the specific product event requiring trust and why the chosen credential is the minimum sufficient assurance.
- Demonstrate a successful verification and one meaningful alternative path, such as cancellation, unavailable credential, rejection, or an ineligible user.
- Include a short integration debrief/feedback: time to first success, friction encountered, missing capability or documentation, and the one improvement with the greatest impact.


# ENS: ETHGlobal Mumbai 2026

Track: **Best Use of ENSv2**

Prize page: https://ethglobal.com/events/mumbai/prizes/ens

---

## 🧬 Best Use of ENSv2 ($7,000)

1st $3,000 · 2nd $2,000 · 3rd $1,000 · 3rd $1,000

ENSv2 is now live on Ethereum mainnet. Be among the first to build on it. Explore the new hierarchical registry structure: resolve subnames straight off a parent's resolver with wildcard resolution, or deploy your own subname registry to tokenize and manage subnames under your own rules. Use Enhanced Access Control, the shared, role-based permission system behind both registries and resolvers, to delegate specific rights, like letting an account edit only certain text records on a name. Give subnames their own Permissioned Resolver so they fully own their data, mix in record aliasing at the resolver level or namespace aliasing via a shared registry, and combine it all to build subname setups: expiring, revocable, non-transferable vs. transferable, even forever names with no parent control. Bonus points if you bring AI agents into the mix. Think agents as namespaces, each with their own identity and permissions.

### Qualification Requirements

Project must be built on ENSv2 on Ethereum mainnet or Sepolia. ENSv2 features should be central to the product, not a cosmetic add-on. Your demo must be functional and not just include hard-coded values. Upon submission, your project showcase must have a link to a live demo and the code needs to be open source and accessible on Github or a similar platform.
