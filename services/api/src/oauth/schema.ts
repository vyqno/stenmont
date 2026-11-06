import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

// OAuth 2.1 for AI agents acting for a business. Codes and tokens are stored only as SHA-256 hashes; the plaintext is shown once.

export const oauthClients = sqliteTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").notNull(), // JSON array, matched exactly
  createdAt: text("created_at").notNull(),
});

/** One consent. All tokens of a grant die together when it is revoked (or when a code or refresh token is replayed). */
export const oauthGrants = sqliteTable(
  "oauth_grants",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    clientId: text("client_id").notNull(),
    scopes: text("scopes").notNull(), // space separated
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("oauth_grants_merchant_idx").on(t.merchantId)],
);

export const oauthCodes = sqliteTable("oauth_codes", {
  hash: text("hash").primaryKey(),
  clientId: text("client_id").notNull(),
  merchantId: text("merchant_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes").notNull(),
  codeChallenge: text("code_challenge").notNull(), // S256 only
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  grantId: text("grant_id"), // set when the code is redeemed, so a replay can revoke that grant
  createdAt: text("created_at").notNull(),
});

export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    hash: text("hash").primaryKey(),
    grantId: text("grant_id").notNull(),
    kind: text("kind").notNull(), // access | refresh
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"), // refresh tokens rotate: a second use is a replay
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("oauth_tokens_grant_idx").on(t.grantId)],
);
