import {expect,it} from "vitest";
import {ledgerLineHash,booksJson} from "../src/books";
import {buildTree} from "../src/merkle";
// Independently calculated by Foundry cast keccak over the documented UTF-8 preimage and sorted 64-byte pairs.
it("matches independent complete-line hashes and odd-node root",()=>{
 const hashes=[1,2,3].map(seq=>ledgerLineHash("m_vector","2026-10",{seq,amount:String(seq*100),description:"Payment",currency:"USDT"}));
 expect(hashes).toEqual(["0xe8ec76f96c755ea5540366d41e582171d424c693c1f9566494e1322a6e74ac5f","0xc99c761a475b3d715ca375106b7ca82589119631230d1a8af64da575de999f97","0x85b0dc71475b9cf068ccc553ae1dd107f2171d126c95b83c2eadad677d251d55"]);
 expect(buildTree(hashes).root).toBe("0x08eba1c9034e32134def0fcd19c33c2d1e9cd8d83693196d72813964190462d5");
 expect(booksJson({b:2n,a:[1,"x"]})).toBe('{"a":[1,"x"],"b":"2"}');
});
