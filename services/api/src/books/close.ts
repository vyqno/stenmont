import { booksJson, buildTree, bundleDigest, ledgerLineHash, type MonthBundle } from "@stenmont/shared";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import type { Result } from "./reconcile";

/** Service attestation, not a merchant/passkey signature. The chain anchor requires separate merchant consent. */
export async function createBundle(merchantId:string, result:Result, closedAt:string, signingKey:Hex):Promise<MonthBundle> {
  const snapshot = JSON.parse(booksJson(result)) as MonthBundle["snapshot"];
  const root = buildTree(snapshot.lines.map(l => ledgerLineHash(merchantId,result.period,l))).root;
  const account = privateKeyToAccount(signingKey);
  const payload:Omit<MonthBundle,"signature"> = {version:"stenmont.books.v1",merchantId,period:result.period,closedAt,root,lineCount:snapshot.lines.length,snapshot,signer:account.address};
  return {...payload,signature:await account.signMessage({message:{raw:bundleDigest(payload)}})};
}
