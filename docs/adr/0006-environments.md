# Environments: local, staging (public testnet), production (mainnet)

Status: accepted

## Context
We need a safe path for changes and a stable public demo.

## Decision
Local first, then staging, then production. Staging is the public deployment on the Whitechain testnet. Production is reserved for mainnet and nothing is deployed there. Production scripts refuse to run without an explicit confirmation variable.

## Consequences
A mistake cannot reach real money by accident. The cost: two environments to keep in step.
