import { expect,it } from "vitest";
import { verifyLedgerLine } from "../lib/booksProof";
// Fixed vectors independently produced with Foundry cast keccak, not the shared implementation.
const root="0x08eba1c9034e32134def0fcd19c33c2d1e9cd8d83693196d72813964190462d5";
const proof=["0x9290d94d4c0d5f9b523d439ae5fa81c14ddcd32ed3010378d8201a3e405bdbe8"];
it("verifies the odd carried leaf in the independent three-line vector and rejects tampering",()=>{
 const line={seq:1,amount:"100",description:"Payment",currency:"USDT"};
 expect(verifyLedgerLine({merchantId:"m_vector",period:"2026-10",line,proof,root})).toBe(true);
 expect(verifyLedgerLine({merchantId:"m_vector",period:"2026-10",line:{...line,amount:"101"},proof,root})).toBe(false);
 expect(verifyLedgerLine({merchantId:"m_other",period:"2026-10",line,proof,root})).toBe(false);
 expect(verifyLedgerLine({merchantId:"m_vector",period:"2026-10",line,proof:["invalid"],root})).toBe(false);
});
