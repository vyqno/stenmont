import { Hono } from "hono";
import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { USDT_ADDRESS, buildTransferAuth } from "@stenmont/shared";
import { transferCalldata, viemChain, type Auth, type Chain, type ChainEnv } from "./chain";
import { D1Store, type SettlementStore } from "./store";
import { D1Counters, D1Payees, DEFAULT_LIMITS, limitsFromEnv, type CounterStore, type Limits, type PayeeStore } from "./guard";

export const NETWORK = "eip155:1874";
const MIN_WBT_DEFAULT = 20_000_000_000_000_000n; // 0.02 WBT, same floor as the API relayer
const VALIDITY_MARGIN = 6; // seconds; the authorization must still be valid when the tx lands

const addr = z.string().refine(isAddress, "address");
const uint = z.string().regex(/^\d{1,78}$/);
const requirementsSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  asset: z.string(),
  amount: uint,
  payTo: addr,
  maxTimeoutSeconds: z.number().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
const payloadSchema = z.object({
  x402Version: z.number().optional(),
  accepted: requirementsSchema,
  payload: z.object({
    signature: z.string().refine((s) => isHex(s) && s.length > 2, "hex"),
    authorization: z.object({ from: addr, to: addr, value: uint, validAfter: uint, validBefore: uint, nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  }),
});
const bodySchema = z.object({ x402Version: z.number().optional(), paymentPayload: payloadSchema, paymentRequirements: requirementsSchema });

type Requirements = z.infer<typeof requirementsSchema>;
type Payload = z.infer<typeof payloadSchema>;
type Verdict = { ok: true; payer: Address; auth: Auth } | { ok: false; reason: string; payer?: Address };

export type Deps = {
  chain: Chain;
  store: SettlementStore;
  now: () => number;
  minWbtWei?: bigint;
  /** Only these payees are served. The Worker always sets it; left out only in tests of the core checks. */
  payees?: PayeeStore;
  counters?: CounterStore;
  limits?: Limits;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const bad = (reason: string, payer?: Address): Verdict => ({ ok: false, reason, payer });

async function payeeAllowed(d: Deps, payTo: string) {
  return !d.payees || (await d.payees.isAllowed(payTo));
}

/** Counts one settlement against the global, payee and payer windows; all or nothing. Returns the buckets taken, or the refusal reason. */
async function takeCaps(d: Deps, payer: Address, payTo: string): Promise<{ buckets: string[] } | { reason: string }> {
  if (!d.counters) return { buckets: [] };
  const l = d.limits ?? DEFAULT_LIMITS;
  const day = Math.floor(d.now() / 86400);
  const minute = Math.floor(d.now() / 60);
  const plan: [string, number, string][] = [
    [`payer:${payer.toLowerCase()}:${minute}`, l.perPayerMinute, "payer_rate_limited"],
    [`payee:${payTo.toLowerCase()}:${day}`, l.perPayeeDay, "payee_daily_cap_reached"],
    [`global:${day}`, l.globalDay, "global_daily_cap_reached"],
  ];
  const taken: string[] = [];
  for (const [bucket, limit, reason] of plan) {
    if (!(await d.counters.hit(bucket, limit))) {
      for (const b of taken) await d.counters.unhit(b);
      return { reason };
    }
    taken.push(bucket);
  }
  return { buckets: taken };
}

async function check(d: Deps, p: Payload, r: Requirements): Promise<Verdict> {
  const a = p.payload.authorization;
  const payer = getAddress(a.from);
  if (!(await payeeAllowed(d, r.payTo))) return bad("payee_not_allowed", payer);
  if (r.scheme !== "exact" || p.accepted.scheme !== "exact") return bad("invalid_scheme", payer);
  if (r.network !== NETWORK || p.accepted.network !== NETWORK) return bad("invalid_network", payer);
  if (!same(r.asset, USDT_ADDRESS) || !same(p.accepted.asset, USDT_ADDRESS)) return bad("invalid_exact_evm_payload_asset", payer);
  if (!same(a.to, r.payTo) || !same(p.accepted.payTo, r.payTo)) return bad("invalid_exact_evm_payload_recipient_mismatch", payer);
  if (a.value !== r.amount || p.accepted.amount !== r.amount) return bad("invalid_exact_evm_payload_authorization_value", payer);
  const now = BigInt(d.now());
  if (BigInt(a.validBefore) < now + BigInt(VALIDITY_MARGIN)) return bad("invalid_exact_evm_payload_authorization_valid_before", payer);
  if (BigInt(a.validAfter) > now) return bad("invalid_exact_evm_payload_authorization_valid_after", payer);

  const auth: Auth = { from: payer, to: getAddress(a.to), value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce as Hex, signature: p.payload.signature as Hex };
  try {
    const ok = await d.chain.verifySignature({ address: payer, typedData: buildTransferAuth(auth), signature: auth.signature });
    if (!ok) return bad("invalid_exact_evm_payload_signature", payer);
    if ((await d.chain.usdtBalance(payer)) < auth.value) return bad("insufficient_funds", payer);
    if (await d.chain.authorizationUsed(payer, auth.nonce)) return bad("invalid_exact_evm_payload_authorization_nonce_used", payer);
    await d.chain.simulateTransfer(auth);
  } catch (e) {
    console.error("verify failed:", e instanceof Error ? e.name : "error"); // never the message: it can carry RPC URLs
    return bad("invalid_transaction_state", payer);
  }
  return { ok: true, payer, auth };
}

async function settle(d: Deps, p: Payload, r: Requirements) {
  const fail = (errorReason: string, payer?: Address, transaction = "") => ({ success: false as const, errorReason, payer, transaction, network: NETWORK });
  const v = await check(d, p, r);
  if (!v.ok) return fail(v.reason, v.payer);

  // Everything below can fail; nothing is claimed until the facilitator has proved it can pay for gas.
  try {
    const floor = (d.minWbtWei ?? MIN_WBT_DEFAULT) + (await d.chain.estimateCost());
    if ((await d.chain.facilitatorBalance()) < floor) return fail("facilitator_low_funds", v.payer);
  } catch (e) {
    console.error("balance check failed:", e instanceof Error ? e.name : "error");
    return fail("settlement_failed", v.payer);
  }

  const caps = await takeCaps(d, v.payer, r.payTo);
  if ("reason" in caps) return fail(caps.reason, v.payer);
  const giveBack = async () => {
    for (const b of caps.buckets) await d.counters!.unhit(b);
  };

  const key = `${v.payer}:${v.auth.nonce}`.toLowerCase();
  if (!(await d.store.claim(key))) {
    await giveBack();
    return fail("duplicate_settlement", v.payer, (await d.store.get(key))?.tx ?? "");
  }

  let tx: Hex;
  try {
    tx = await d.chain.send({ to: USDT_ADDRESS, data: transferCalldata(v.auth) });
  } catch (e) {
    console.error("send failed:", e instanceof Error ? e.name : "error");
    await d.store.release(key); // nothing was broadcast
    await giveBack();
    return fail("settlement_failed", v.payer);
  }
  await d.store.setTx(key, tx);
  try {
    const receipt = await d.chain.waitForReceipt(tx);
    if (receipt.status !== "success") {
      await d.store.release(key); // reverted: the authorization is still unused
      await giveBack();
      return fail("invalid_transaction_state", v.payer, tx);
    }
  } catch {
    return fail("settlement_pending", v.payer, tx); // may still land: keep the claim so it cannot be sent twice
  }
  await d.store.markSettled(key, tx);
  return { success: true as const, payer: v.payer, transaction: tx, network: NETWORK };
}

export function createApp(d: Deps) {
  const app = new Hono();
  app.get("/supported", (c) => c.json({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} }));
  const route = (path: string, run: (b: z.infer<typeof bodySchema>) => Promise<unknown>) =>
    app.post(path, async (c) => {
      const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
      return c.json(await run(parsed.data));
    });
  route("/verify", async (b) => {
    const v = await check(d, b.paymentPayload, b.paymentRequirements);
    return v.ok ? { isValid: true, payer: v.payer } : { isValid: false, invalidReason: v.reason, payer: v.payer };
  });
  route("/settle", (b) => settle(d, b.paymentPayload, b.paymentRequirements));
  return app;
}

type Env = ChainEnv & {
  DB: D1Database;
  MIN_FACILITATOR_WBT_WEI?: string;
  SETTLE_MAX_PER_PAYEE_DAY?: string;
  SETTLE_MAX_GLOBAL_DAY?: string;
  SETTLE_MAX_PER_PAYER_MINUTE?: string;
};

export default {
  fetch(req: Request, env: Env) {
    const app = createApp({
      chain: viemChain(env),
      store: new D1Store(env.DB),
      now: () => Math.floor(Date.now() / 1000),
      payees: new D1Payees(env.DB),
      counters: new D1Counters(env.DB),
      limits: limitsFromEnv(env),
      minWbtWei: env.MIN_FACILITATOR_WBT_WEI ? BigInt(env.MIN_FACILITATOR_WBT_WEI) : undefined,
    });
    return app.fetch(req);
  },
};
