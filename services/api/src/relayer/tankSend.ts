import type { Hex } from "viem";
import type { Db } from "../app";
import { Rejected, type ChainClient } from "../chain";
import { RELAYER_MIN_BALANCE_WEI, holdGas, loadTank } from "./caps";
import type { Call } from "./sender";

export type TankSend =
  | { ok: true; txHash: Hex }
  | { ok: false; code: "gas_tank_empty" | "gas_cap_reached" | "busy" | "relayer_low" | "chain_error" | "tx_reverted" | "timeout"; txHash?: Hex }
  | { ok: false; code: "rejected"; reason: string };

/**
 * Sends one transaction paid from a merchant's gas tank: free pre-check, simulate (nothing is sent if the contracts
 * would reject it), reserve the worst-case gas atomically, send through the single sender, then charge the real cost.
 */
export async function sendFromTank(ctx: { db: Db; chain: ChainClient; now: Date }, merchantId: string, call: Call): Promise<TankSend> {
  const { db, chain, now } = ctx;
  const tank = await loadTank(db, merchantId, now);
  if (!tank || tank.balance === 0n) return { ok: false, code: "gas_tank_empty" };

  let gas: bigint;
  try {
    gas = await chain.estimateGas(call);
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, code: "rejected", reason: e.reason };
    console.error("estimateGas failed", e);
    return { ok: false, code: "chain_error" };
  }
  const gasLimit = (gas * 125n) / 100n;
  let maxCost: bigint;
  try {
    maxCost = gasLimit * (await chain.gasPrice());
    if ((await chain.relayerBalance()) < maxCost + RELAYER_MIN_BALANCE_WEI) return { ok: false, code: "relayer_low" };
  } catch (e) {
    console.error("price lookup failed", e);
    return { ok: false, code: "chain_error" };
  }
  const hold = await holdGas(db, merchantId, maxCost, now);
  if (typeof hold === "string") return { ok: false, code: hold === "payer_cap" ? "busy" : hold };

  let txHash: Hex;
  try {
    txHash = await chain.sendTransaction({ ...call, gas: gasLimit });
  } catch (e) {
    // Unknown broadcast outcome: a transport error is not authority to refund gas or resend.
    console.error("send response uncertain; reservation stays held", e);
    return { ok: false, code: "timeout" };
  }
  await hold.sent(txHash);
  try {
    const receipt = await chain.waitForReceipt(txHash);
    // If settling cannot be written the full reservation stays charged: the merchant is over- never under-charged.
    await hold.settle(receipt.gasUsed * receipt.effectiveGasPrice, receipt).catch((err) => console.error("gas settlement failed; reservation stays held", err));
    return receipt.status === "success" ? { ok: true, txHash } : { ok: false, code: "tx_reverted", txHash };
  } catch (e) {
    console.error("receipt wait failed", e); // it may still land; the reservation stays until reconciled
    return { ok: false, code: "timeout", txHash };
  }
}
