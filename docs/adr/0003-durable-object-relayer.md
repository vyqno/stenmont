# One Durable Object sends every relayer transaction

Status: accepted

## Context
Many requests at once must not collide on a nonce or overspend the gas budget.

## Decision
A single Durable Object owns the relayer key and sends transactions one at a time with consecutive nonces. Gas is reserved atomically from the merchant's tank before sending and settled after the receipt. Every call is simulated first.

## Consequences
No nonce races and no wasted gas on bad requests. The cost: one writer is a throughput ceiling and a single point of failure; a second sender is the way to scale.
