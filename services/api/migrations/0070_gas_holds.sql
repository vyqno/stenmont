CREATE TABLE relayer_gas_holds (
 id TEXT PRIMARY KEY,
 merchant_id TEXT NOT NULL,
 reserved TEXT NOT NULL,
 reserved_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'held',
 tx_hash TEXT,
 relayer_tx_id TEXT,
 payer TEXT,
 payer_value TEXT,
 receipt_status TEXT,
 gas_used TEXT,
 actual_cost TEXT,
 payer_released INTEGER NOT NULL DEFAULT 0,
 last_checked_at TEXT
);
CREATE INDEX relayer_gas_holds_pending ON relayer_gas_holds(status,last_checked_at);
CREATE UNIQUE INDEX relayer_gas_holds_tx ON relayer_gas_holds(tx_hash) WHERE tx_hash IS NOT NULL;
