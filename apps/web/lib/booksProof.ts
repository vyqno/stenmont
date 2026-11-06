import { concatHex, keccak256, stringToHex, type Hex } from "viem";
/** Independent offline implementation: deliberately does not import the shared tree or encoder. */
function canonical(value:unknown):string {
  if(value===null || typeof value!=="object") return JSON.stringify(typeof value==="bigint"?value.toString():value);
  if(Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  const obj=value as Record<string,unknown>;
  return "{"+Object.keys(obj).sort().map(key=>JSON.stringify(key)+":"+canonical(obj[key])).join(",")+"}";
}
export type LedgerProof={merchantId:string;period:string;line:unknown;proof:string[];root:string};
export function verifyLedgerLine(input:LedgerProof):boolean {
  try {
    if(!/^0x[0-9a-fA-F]{64}$/.test(input.root)||!input.proof.every(p=>/^0x[0-9a-fA-F]{64}$/.test(p))) return false;
    let node=keccak256(stringToHex(canonical(["stenmont.books.line.v1",input.merchantId,input.period,input.line])));
    for(const sibling of input.proof) {
      const other=sibling.toLowerCase() as Hex;
      node=keccak256(concatHex(node<other?[node,other]:[other,node]));
    }
    return node===input.root.toLowerCase();
  } catch {return false;}
}
