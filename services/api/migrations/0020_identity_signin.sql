CREATE TABLE identity_subjects (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, subject TEXT NOT NULL,
 email TEXT NOT NULL, merchant_id TEXT, created_at TEXT NOT NULL,
 UNIQUE(provider,subject)
);
CREATE TABLE identity_sessions (
 token_hash TEXT PRIMARY KEY, identity_id TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE identity_email_codes (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT, expires_at TEXT NOT NULL
);
CREATE TABLE identity_google_flows (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL,
 verifier TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
