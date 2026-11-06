import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { MULTICALL3_ADDRESS, multicall3Abi, passkeyAccountFactoryAbi, payNonce, paymentRouterAbi } from "@stenmont/shared";
import type { Db } from "../app";
import { Rejected, type ChainClient } from "../chain";
import { invoices, paymentSwitch, relayerTxs } from "../db/schema";
import type { Env } from "../env";
import {
  RATE_LIMIT_PER_MINUTE,
  RELAYER_MIN_BALANCE_WEI,
  checkCaps,
  hitRateLimit,
  holdGas,
  releasePayer,
  reservePayer,
  loadTank,
  type CapError,
  type GasHold,
} from "./caps";

export type RelayErrorCode =
  | "rate_limited"
  | "invoice_not_found"
  | "invoice_not_payable"
  | "payments_paused"
  | "gas_tank_empty"
  | "gas_cap_reached"
  | "payer_cap"
  | "busy"
  | "duplicate"
  | "account_mismatch"
  | "overpay"
  | "below_minimum"
  | "wrong_payer"
  | "invalid_authorization"
  | "relayer_low"
  | "chain_error"
  | "tx_reverted"
  | "timeout";

export const STATUS_OF: Record<RelayErrorCode, 402 | 403 | 404 | 409 | 422 | 429 | 502 | 503 | 504> = {
  rate_limited: 429,
  invoice_not_found: 404,
  invoice_not_payable: 409,
  payments_paused: 403,
  gas_tank_empty: 402,
  gas_cap_reached: 429,
  payer_cap: 429,
  busy: 503,
  duplicate: 409,
  account_mismatch: 422,
  overpay: 422,
  below_minimum: 422,
  wrong_payer: 422,
  invalid_authorization: 422,
  relayer_low: 503,
  chain_error: 502,
  tx_reverted: 502,
  timeout: 504,
};

export type RelayInput = {
  invoiceId: Hex;
  value: bigint;
  payer: Address;
  validAfter: bigint;
  validBefore: bigint;
  salt: Hex;
  signature: Hex;
  account?: { qx: Hex; qy: Hex; salt: Hex };
  ip: string | null;
};
export type RelayOutcome =
  | { ok: true; txHash: Hex; deployedAccount: boolean }
  | { ok: false; code: RelayErrorCode; message: string; txHash?: Hex };

const MESSAGES: Record<RelayErrorCode, string> = {
  rate_limited: "Too many requests. Try again in a minute.",
  invoice_not_found: "Invoice not found.",
  invoice_not_payable: "This invoice can no longer be paid.",
  payments_paused: "This business has paused payments for now.",
  gas_tank_empty: "This merchant cannot accept payments right now.",
  gas_cap_reached: "This merchant has reached today's limit. Try again tomorrow.",
  payer_cap: "Daily payment limit reached.",
  busy: "The service is busy. Try again.",
  duplicate: "This payment was already submitted.",
  account_mismatch: "The account details do not match the payer.",
  overpay: "The amount is more than what is still owed.",
  below_minimum: "The amount is below the minimum for this invoice.",
  wrong_payer: "This invoice is reserved for a different payer.",
  invalid_authorization: "The payment authorization was rejected.",
  relayer_low: "Payments are temporarily unavailable.",
  chain_error: "The payment could not be submitted. Try again.",
  tx_reverted: "The payment failed.",
  timeout: "The payment is taking longer than expected. It may still complete.",
};
const fail = (code: RelayErrorCode, txHash?: Hex): RelayOutcome => ({ ok: false, code, message: MESSAGES[code], ...(txHash ? { txHash } : {}) });

const REJECTION: Record<string, RelayErrorCode> = {
  InvoiceNotOpen: "invoice_not_payable",
  InvoiceNotFound: "invoice_not_found",
  Overpay: "overpay",
  BelowMinimum: "below_minimum",
  WrongPayer: "wrong_payer",
};

/**
 * Pays an invoice on a payer's behalf: checks limits, simulates, reserves gas from the merchant's tank, sends the
 * transaction through the single Durable Object sender, then settles the real cost. A passkey account that does not
 * exist yet is created in the same transaction (Multicall3).
 *
 * Money safety comes from the contract (the signature is bound to this invoice and amount). Everything here protects
 * the relayer's gas: nothing is sent unless the simulation succeeds, and nothing can spend more than the tank, the
 * daily cap or the per-payer cap allows, even under concurrency.
 */
export async function relayPay(ctx: { db: Db; chain: ChainClient; env: Env; now: Date }, i: RelayInput): Promise<RelayOutcome> {
  const { db, chain, env, now } = ctx;

  // 1. rate limits (every attempt counts, valid or not)
  const byPayer = await hitRateLimit(db, `pay:payer:${i.payer.toLowerCase()}`, RATE_LIMIT_PER_MINUTE, 60, now);
  const byIp = await hitRateLimit(db, `pay:ip:${i.ip ?? "unknown"}`, RATE_LIMIT_PER_MINUTE, 60, now);
  if (!byPayer || !byIp) return fail("rate_limited");

  // 2. the invoice must exist and still be payable
  // (the pause switch rides along in the same query, so the payment path gains no extra round trip)
  const [found] = await db
    .select({ inv: invoices, paused: paymentSwitch.paused })
    .from(invoices)
    .leftJoin(paymentSwitch, eq(paymentSwitch.merchantId, invoices.merchantId))
    .where(eq(invoices.id, i.invoiceId));
  const inv = found?.inv;
  if (!inv || inv.status === "creating" || inv.status === "failed") return fail("invoice_not_found");
  if (inv.status !== "open" && inv.status !== "partially_paid") return fail("invoice_not_payable");
  const merchantId = inv.merchantId;
  if (found!.paused === 1) return fail("payments_paused");

  // 3. free pre-check: empty tank or exhausted payer
  const early = await checkCaps(db, merchantId, i.payer, i.value, now);
  if (early !== "ok") return fail(early);

  // 4. the call: a plain payment, or deploy-the-account-then-pay in one transaction
  const payData = encodeFunctionData({
    abi: paymentRouterAbi,
    functionName: "pay",
    args: [i.invoiceId, i.value, { payer: i.payer, validAfter: i.validAfter, validBefore: i.validBefore, salt: i.salt, signature: i.signature }],
  });
  let call = { to: env.ROUTER_ADDRESS as Address, data: payData };
  let kind: "pay" | "deploy_pay" = "pay";
  if (i.account && !(await chain.hasCode(i.payer))) {
    const expected = await chain.passkeyAddress(i.account.qx, i.account.qy, i.account.salt);
    if (expected.toLowerCase() !== i.payer.toLowerCase()) return fail("account_mismatch");
    const createData = encodeFunctionData({ abi: passkeyAccountFactoryAbi, functionName: "createAccount", args: [i.account.qx, i.account.qy, i.account.salt] });
    call = {
      to: MULTICALL3_ADDRESS,
      data: encodeFunctionData({
        abi: multicall3Abi,
        functionName: "aggregate3",
        args: [[{ target: env.FACTORY_ADDRESS as Address, allowFailure: false, callData: createData }, { target: env.ROUTER_ADDRESS as Address, allowFailure: false, callData: payData }]],
      }),
    };
    kind = "deploy_pay";
  }

  // 5. one transaction per authorization: the unique key makes a replay a 409 and never a second send
  const rowId = crypto.randomUUID();
  const stamp = now.toISOString();
  const claimed = await db
    .insert(relayerTxs)
    .values({
      id: rowId,
      merchantId,
      invoiceId: i.invoiceId,
      kind,
      payer: i.payer,
      value: i.value.toString(),
      status: "pending",
      idempotencyKey: `pay:${i.payer.toLowerCase()}:${payNonce(i.invoiceId, i.salt)}`,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .onConflictDoNothing()
    .returning({ id: relayerTxs.id });
  if (claimed.length === 0) return fail("duplicate");

  let hold: GasHold | null = null;
  let payerReserved = false;
  /** Gives back everything this request holds. Safe to call twice; one failing step never skips the others. */
  const release = async () => {
    const gas = hold;
    const payer = payerReserved;
    hold = null;
    payerReserved = false;
    if (gas) await gas.release().catch((e) => console.error("gas release failed", e));
    if (payer) await releasePayer(db, merchantId, i.payer, i.value, now).catch((e) => console.error("payer release failed", e));
    await db.delete(relayerTxs).where(eq(relayerTxs.id, rowId)); // frees the authorization to be tried again
  };

  // 6. simulate: nothing is sent unless the contracts would accept it
  let gas: bigint;
  try {
    gas = await chain.estimateGas(call);
  } catch (e) {
    await release();
    if (e instanceof Rejected) return fail(REJECTION[e.reason] ?? "invalid_authorization");
    console.error("estimateGas failed", e);
    return fail("chain_error");
  }

  // 7. budget: relayer wallet, merchant tank, daily cap, payer cap, reserved atomically
  const gasLimit = (gas * 125n) / 100n;
  let maxCost: bigint;
  try {
    maxCost = gasLimit * (await chain.gasPrice());
    if ((await chain.relayerBalance()) < maxCost + RELAYER_MIN_BALANCE_WEI) {
      await release();
      return fail("relayer_low");
    }
  } catch (e) {
    await release();
    console.error("price lookup failed", e);
    return fail("chain_error");
  }
  const held = await holdGas(db, merchantId, maxCost, now);
  if (typeof held === "string") {
    // The daily cap counts reservations that other payments are still holding. If any are in flight, this is a
    // transient shortage ("busy, retry"), not the merchant's limit being reached.
    const recent = new Date(now.getTime() - 120_000).toISOString();
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(relayerTxs)
      .where(and(eq(relayerTxs.merchantId, merchantId), inArray(relayerTxs.status, ["pending", "sent"]), gt(relayerTxs.updatedAt, recent)));
    await release();
    return fail(held === "gas_cap_reached" && n > 1 ? "busy" : held); // n includes this request's own row
  }
  hold = held;
  const tank = await loadTank(db, merchantId, now);
  const payerHold = await reservePayer(db, merchantId, i.payer, i.value, tank?.perPayerCap ?? 0n, now);
  if (payerHold !== "ok") {
    await release();
    return fail(payerHold as CapError);
  }
  payerReserved = true;

  // 8. send through the Durable Object (one at a time, consecutive nonces)
  let txHash: Hex;
  try {
    txHash = await chain.sendTransaction({ ...call, gas: gasLimit });
  } catch (e) {
    await release();
    console.error("send failed", e);
    return fail("chain_error");
  }
  await hold.sent(txHash, {id:rowId,payer:i.payer,value:i.value});

  // 9. wait for the receipt and settle the real cost
  let receipt;
  try {
    receipt = await chain.waitForReceipt(txHash);
  } catch (e) {
    console.error("receipt wait failed", e);
    return fail("timeout", txHash); // it may still land; the reservation stays until it is reconciled
  }
  const actual = receipt.gasUsed * receipt.effectiveGasPrice;
  // If settling cannot be written the full reservation stays charged: the merchant is over- never under-charged.
  await hold.settle(actual, receipt).catch((e) => console.error("gas settlement failed; reservation stays held", e));
  const done = { gasUsed: receipt.gasUsed.toString(), wbtCost: actual.toString(), updatedAt: now.toISOString() };
  if (receipt.status !== "success") {
    await db.update(relayerTxs).set({ ...done, status: "reverted" }).where(eq(relayerTxs.id, rowId));
    return fail("tx_reverted", txHash);
  }
  await db.update(relayerTxs).set({ ...done, status: "success" }).where(and(eq(relayerTxs.id, rowId)));
  return { ok: true, txHash, deployedAccount: kind === "deploy_pay" };
}
