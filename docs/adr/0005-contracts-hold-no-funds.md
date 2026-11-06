# Contracts never hold customer funds

Status: accepted

## Context
A payment router that keeps balances is a target and a liability.

## Decision
Payments move straight from payer to payout inside one transaction. The router's USDT balance is zero after every call (an invariant test checks it). Invoices sold to investors use a payout hook that forwards the money.

## Consequences
Smaller blast radius. The cost: more logic runs in the payer's transaction, and anything sent to the router by mistake cannot be recovered.
