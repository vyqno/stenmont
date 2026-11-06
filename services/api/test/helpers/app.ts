import { createApp } from "../../src/app";
import type { ChainClient } from "../../src/chain";
import type { Env } from "../../src/env";
import { newD1 } from "./d1";
import { fakeChain } from "./chain";
import { fakeEns } from "./ens";
import { sha256Hex } from "../../src/lib/crypto";

export const MERCHANT_ADDRESS = "0x50c94c3021962047F10c9c58D80C4A7b73182a63";
export const PAYOUT_ADDRESS = "0x1111111111111111111111111111111111111111";

export const baseEnv = (db: D1Database): Env =>
  ({
    DB: db,
    ENVIRONMENT: "test",
    WHITECHAIN_RPC: "http://localhost",
    WHITECHAIN_CHAIN_ID: "1874",
    USDT_ADDRESS: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7",
    ROUTER_ADDRESS: "0xA5B6C9206Db75fD59307Bd22f7703387Bb8aB929",
    ROUTER_DEPLOY_BLOCK: "100",
    APP_URL: "https://app.test",
    API_URL: "https://api.test",
    FACTORY_ADDRESS: "0x5101c37647581c81b462436af2D7ac8ccD08D33A",
    SUBSCRIPTION_MANAGER_ADDRESS: "0x3e1C51d461e6adb0b087DC39d41942E084eba2DD",
    FAUCET_PRIVATE_KEY: `0x${"ab".repeat(32)}`,
    WEBHOOKS: { send: async () => {} },
  }) as unknown as Env;

/** Inserts a merchant and an API key; returns the plaintext key. */
export async function seedMerchant(db: D1Database, id = "m_1", name = "Acme", key = `sk_test_${"a".repeat(32)}`) {
  const now = new Date().toISOString();
  await db
    .prepare("insert into merchants (id, name, address, payout_address, created_at) values (?,?,?,?,?)")
    .bind(id, name, MERCHANT_ADDRESS, PAYOUT_ADDRESS, now)
    .run();
  await db
    .prepare("insert into api_keys (id, merchant_id, prefix, hash, scopes, created_at) values (?,?,?,?,?,?)")
    .bind(`k_${id}`, id, key.slice(8, 16), await sha256Hex(key), "*", now)
    .run();
  return key;
}

export function setup(chainOverrides: Partial<ChainClient> = {}, envOverrides: Partial<Env> = {}, extra: { fetch?: typeof fetch } = {}) {
  const db = newD1();
  const chain = fakeChain(chainOverrides);
  const ens = fakeEns();
  const env = { ...baseEnv(db), ...envOverrides } as Env;
  const clock = { now: new Date("2026-11-06T12:00:00Z") };
  const app = createApp({ chain: () => chain, ens: () => ens, now: () => clock.now, ...(extra.fetch ? { fetch: extra.fetch } : {}) });
  const req = (path: string, init: RequestInit & { key?: string; idem?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (init.key) headers.set("authorization", `Bearer ${init.key}`);
    if (init.idem) headers.set("idempotency-key", init.idem);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return app.request(path, { ...init, headers }, env);
  };
  return { db, chain, ens, env, app, req, clock };
}
