-- Merchants whose payments this facilitator will settle (lowercase 0x address). Add with:
--   wrangler d1 execute <db> --env staging --command "INSERT INTO payees (address) VALUES ('0x...')"
CREATE TABLE payees (
  address TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Fixed-window counters: bucket = 'global:<day>' | 'payee:<addr>:<day>' | 'payer:<addr>:<minute>'.
CREATE TABLE counters (
  bucket TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
