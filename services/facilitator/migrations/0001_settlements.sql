CREATE TABLE settlements (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  tx TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
