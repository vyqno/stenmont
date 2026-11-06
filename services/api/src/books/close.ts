import { booksJson, buildTree, bundleDigest, ledgerLineHash, type MonthBundle } from "@stenmont/shared";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { periodBounds, type Result } from "./reconcile";

/** Service attestation, not a merchant/passkey signature. The chain anchor requires separate merchant consent. */
export async function createBundle(merchantId:string, result:Result, closedAt:string, signingKey:Hex, closeKind:MonthBundle["closeKind"]="final_month", sourceCutoffAt=closeKind==="interim_staging"?closedAt:periodBounds(result.period).end):Promise<MonthBundle> {
  const snapshot = JSON.parse(booksJson(result)) as MonthBundle["snapshot"];
  const root = buildTree(snapshot.lines.map(l => ledgerLineHash(merchantId,result.period,l))).root;
  const account = privateKeyToAccount(signingKey);
  const payload:Omit<MonthBundle,"signature"> = {version:"stenmont.books.v1",closeKind,merchantId,period:result.period,closedAt,sourceCutoffAt,root,lineCount:snapshot.lines.length,snapshot,signer:account.address};
  return {...payload,signature:await account.signMessage({message:{raw:bundleDigest(payload)}})};
}
