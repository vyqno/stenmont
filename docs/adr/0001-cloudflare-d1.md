# Use Cloudflare D1 (SQLite) with Drizzle, not Postgres

Status: accepted

## Context
The API runs on Cloudflare Workers and needs a small relational store for invoices, keys, sessions and queues.

## Decision
Use D1 through a Workers binding with Drizzle. Money columns are TEXT holding USDT base units (converted to `bigint` in code). There is no row-level security, so every query is scoped by `merchant_id` and tests cover it.

## Consequences
One vendor, no connection strings or pooling, nothing extra to run. The cost is no Postgres features and discipline about tenant scoping.
