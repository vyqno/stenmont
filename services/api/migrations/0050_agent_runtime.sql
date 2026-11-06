CREATE TABLE agent_conversations (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES merchants(id), created_at TEXT NOT NULL,
 busy INTEGER NOT NULL DEFAULT 0, tools TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX agent_conversations_merchant ON agent_conversations(merchant_id);
CREATE TABLE agent_messages (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES agent_conversations(id),
 role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX agent_messages_conversation ON agent_messages(conversation_id,created_at);
CREATE TABLE agent_provider_keys (
 merchant_id TEXT NOT NULL REFERENCES merchants(id), provider TEXT NOT NULL, sealed TEXT NOT NULL,
 PRIMARY KEY(merchant_id,provider)
);
CREATE TABLE agent_usage (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 provider TEXT NOT NULL, reserved INTEGER NOT NULL CHECK(reserved > 0), actual INTEGER,
 created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled'))
);
CREATE INDEX agent_usage_merchant_time ON agent_usage(merchant_id,created_at);
CREATE TABLE agent_results (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES agent_conversations(id), content TEXT NOT NULL
);
CREATE INDEX agent_results_conversation ON agent_results(conversation_id);
