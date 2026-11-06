import { Hono } from "hono";
import { encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_ADDRESS, buildTransferAuth, fromUnits, toUnits, usdtAbi } from "@stenmont/shared";
import { z } from "zod";
import type { AppEnv } from "../app";
import { Rejected } from "../chain";
import { relayerTxs } from "../db/schema";
import { fail } from "../errors";
import { hitRateLimit } from "../relayer/caps";
import { STATUS_OF, relayPay } from "../relayer/relay";
import { issueAccountToken } from "./account";
import { clientIp } from "../lib/request";
import { amountSchema, invalid } from "../lib/validation";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const word = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const digits = z.string().regex(/^\d{1,20}$/);

const payBody = z.strictObject({
  invoiceId: z.string().regex(/^0x[0-9a-f]{64}$/),
  value: amountSchema,
  payer: address,
  validAfter: digits,
  validBefore: digits,
  salt: word,
  signature: z.string().regex(/^0x([0-9a-fA-F]{2}){1,2048}$/),
  account: z.strictObject({ qx: word, qy: word, salt: word }).optional(),
});

export const relayRoutes = new Hono<AppEnv>();

/** Public. The payer's signature, not a login, authorises the payment; limits protect the gas. */
relayRoutes.post("/pay", async (c) => {
  const parsed = payBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  const b = parsed.data;
  const out = await relayPay(
    { db: c.var.db, chain: c.var.chain, env: c.env, now: c.var.now() },
    {
      invoiceId: b.invoiceId as Hex,
      value: toUnits(b.value),
      payer: b.payer as Address,
      validAfter: BigInt(b.validAfter),
      validBefore: BigInt(b.validBefore),
      salt: b.salt as Hex,
      signature: b.signature as Hex,
      account: b.account as { qx: Hex; qy: Hex; salt: Hex } | undefined,
      ip: clientIp(c),
    },
  );
  if (out.ok) {
    // The payer proved who they are by a signature the token accepted, so they get a link to their own receipts.
    const accountToken = await issueAccountToken(c.env, b.payer, c.var.now());
    return c.json({ status: "success", txHash: out.txHash, deployedAccount: out.deployedAccount, ...(accountToken ? { accountToken } : {}) });
  }
  return fail(c, STATUS_OF[out.code], out.code, out.message, out.txHash ? { txHash: out.txHash } : undefined);
});

/** Where a passkey's account lives, whether it exists yet, and how much it holds. Used by the pay page. */
relayRoutes.post("/account", async (c) => {
  const parsed = z.strictObject({ qx: word, qy: word, salt: word }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!(await hitRateLimit(c.var.db, `account:ip:${clientIp(c) ?? "unknown"}`, 120, 60, c.var.now()))) {
    return fail(c, 429, "rate_limited", "Too many requests. Try again in a minute.");
  }
  const { qx, qy, salt } = parsed.data;
  const addr = await c.var.chain.passkeyAddress(qx as Hex, qy as Hex, salt as Hex);
  const manager = c.env.SUBSCRIPTION_MANAGER_ADDRESS as Address;
  const [deployed, balance, nonce, allowance] = await Promise.all([
    c.var.chain.hasCode(addr),
    c.var.chain.usdtBalance(addr),
    c.var.chain.usdtNonce(addr),
    c.var.chain.usdtAllowance(addr, manager),
  ]);
  return c.json({ address: addr, deployed, balance: fromUnits(balance), permitNonce: nonce.toString(), subscriptionAllowance: fromUnits(allowance) });
});

const FAUCET_AMOUNT = 5_000_000n; // 5 test USDT

/** Test environments only: hands out test USDT so a demo account has something to pay with. */
relayRoutes.post("/faucet", async (c) => {
  if (c.env.ENVIRONMENT === "production") return fail(c, 404, "not_found", "Not found");
  const parsed = z.strictObject({ address }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return invalid(c, parsed.error);
  if (!c.env.FAUCET_PRIVATE_KEY) return fail(c, 503, "faucet_unavailable", "The faucet is not configured");

  const { db, chain } = c.var;
  const now = c.var.now();
  const to = parsed.data.address as Address;
  const limits = [
    await hitRateLimit(db, `faucet:addr:${to.toLowerCase()}`, 1, 86_400, now),
    await hitRateLimit(db, `faucet:ip:${clientIp(c) ?? "unknown"}`, Number(c.env.FAUCET_IP_LIMIT) || 5, 86_400, now),
    await hitRateLimit(db, "faucet:global", 200, 86_400, now),
  ];
  if (limits.includes(false)) return fail(c, 429, "faucet_limit", "Test funds were already claimed. Try again tomorrow.");

  const faucet = privateKeyToAccount(c.env.FAUCET_PRIVATE_KEY as Hex);
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validBefore = BigInt(Math.floor(now.getTime() / 1000) + 3_600);
  const signature = await faucet.signTypedData(buildTransferAuth({ from: faucet.address, to, value: FAUCET_AMOUNT, validAfter: 0n, validBefore, nonce }));
  const call = {
    to: USDT_ADDRESS,
    data: encodeFunctionData({ abi: usdtAbi, functionName: "transferWithAuthorization", args: [faucet.address, to, FAUCET_AMOUNT, 0n, validBefore, nonce, signature] }),
  };
  try {
    await chain.estimateGas(call);
  } catch (e) {
    if (e instanceof Rejected) return fail(c, 422, "faucet_failed", "The faucet could not send funds right now.");
    throw e;
  }
  const txHash = await chain.sendTransaction(call);
  const stamp = now.toISOString();
  await db.insert(relayerTxs).values({
    id: crypto.randomUUID(),
    merchantId: "platform",
    kind: "faucet",
    payer: to,
    value: FAUCET_AMOUNT.toString(),
    txHash,
    status: "sent",
    idempotencyKey: `faucet:${nonce}`,
    createdAt: stamp,
    updatedAt: stamp,
  });
  return c.json({ status: "sent", txHash, amount: fromUnits(FAUCET_AMOUNT) });
});
