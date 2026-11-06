import type { WorldRepo } from "./verify";

/** True when the two sides share any nullifier, i.e. one human stands behind both. */
export const sameHuman = (buyer: readonly string[], supplier: readonly string[]): boolean => {
  const b = new Set(buyer.map((n) => n.toLowerCase()));
  return supplier.some((n) => b.has(n.toLowerCase()));
};

/** Nullifiers are action-scoped, so only enrolments for the same action are comparable. */
export async function assertDifferentHumans(
  repo: Pick<WorldRepo, "nullifiersFor">,
  buyerMerchantId: string,
  supplierMerchantId: string,
  action = "enrol-business-v2",
): Promise<{ ok: true } | { ok: false; code: "same_human" }> {
  const rows = await repo.nullifiersFor([buyerMerchantId, supplierMerchantId], action);
  const of = (id: string) => rows.filter((r) => r.merchantId === id).map((r) => r.nullifier);
  return sameHuman(of(buyerMerchantId), of(supplierMerchantId)) ? { ok: false, code: "same_human" } : { ok: true };
}
