-- Opt-in, bounded read/draft A2A surface. No credentials or external proof payloads are stored here.
CREATE TABLE a2a_access (
  merchant_id TEXT PRIMARY KEY REFERENCES merchants(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  skills TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE TABLE a2a_tasks (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  message_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  task TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(merchant_id,message_id)
);
CREATE INDEX a2a_tasks_merchant_created ON a2a_tasks(merchant_id,created_at);
