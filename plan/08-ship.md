# Phase 8: Ship

**Goal:** a stranger can clone, follow the README and reproduce the demo; every sponsor qualification item has a link; the submission is in.
**Depends on:** all phases kept after the cut line.
**Done when:** the checklist in Task 8.5 is fully ticked.

## Review focus

1. The README's setup commands run on a clean clone (fresh machine or a clean directory) without tribal knowledge.
2. The demo video shows every party: merchant, customer, investor, agent, and a denied World path.
3. Every explorer link in the README opens to a real success transaction of the official USDT.

### Task 8.1: Seed data

**Files:** Create `scripts/seed.mjs`

- [ ] Script creates: merchant `acme.stenmont.eth`, 3 customers, 5 invoices (paid, partly paid, overdue, sold to an investor, refunded), 1 subscription, 1 agent `billing-bot`, 1 allowlisted investor
- [ ] Run `node scripts/seed.mjs` twice → second run creates nothing new (idempotent) and prints the same ids

### Task 8.2: Demo script and video

**Files:** Create `DEMO.md` (the shot list; goes in the repo)

- [ ] Shot list, 2 to 4 minutes, every window labelled with its party: (1) merchant adds Stenmont to the store in 20 lines; (2) customer pays with one tap, no wallet words; (3) merchant sees it, refunds in one tap, World approval for a large refund including a denied attempt; (4) agent pays an x402 endpoint; (5) merchant sells an invoice, investor funds, payer settles
- [ ] Rehearse once against the live deployment with a stopwatch; total is between 2:00 and 4:00
- [ ] Record, upload, put the link in the README

### Task 8.3: README

**Files:** Modify `README.md`

- [ ] Sections: product, how it works (diagram), setup (clone to running in commands), architecture, deployed contract addresses with explorer links, explorer link to a real official-USDT payment, "why onchain stablecoin settlement on Whitechain" (one paragraph: what a card or bank rail cannot do here), current limitations, demo video link
- [ ] Follow the README on a clean clone; fix anything that fails

### Task 8.4: Feedback files

**Files:** Create `WHITECHAIN_FEEDBACK.md`, `WORLD_FEEDBACK.md`, `ENS_FEEDBACK.md` from the notes kept in `BUILDER-NOTES.md`

- [ ] Each: what worked, where we got stuck, what the docs were missing. World file also has: time to first success, friction, missing capability, the one improvement with the greatest impact

### Task 8.5: Submission checklist

- [ ] Contracts verified on Whitechain Sepolia (1874) with explorer links
- [ ] At least one payment of the official USDT in the main flow, explorer link in the README
- [ ] Public GitHub repo, steady history, README complete
- [ ] Demo video 2 to 4 minutes, every party shown
- [ ] `WHITECHAIN_FEEDBACK.md`, `WORLD_FEEDBACK.md`, `ENS_FEEDBACK.md` in the repo
- [ ] World: full journey and a denied path, results validated in the backend, debrief done
- [ ] ENS: ENSv2 central, live demo link, code open source
- [ ] Submit on ETHGlobal for each track entered
