import { describe, expect, it } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import { createBundle } from "../../src/books/close";
import { verifyMonthBundle, ledgerLineHash, buildTree, proofFor, verifyProof } from "@stenmont/shared";
import { reconcile } from "../../src/books/reconcile";
const result = () => reconcile({period:"2026-10",invoices:[],payments:[],refunds:[],claims:[],gas:[]});
describe("signed month bundle", () => {
  it("authenticates the whole snapshot and refuses tampered metadata", async () => {
    const bundle = await createBundle("m_1", result(), "2026-11-01T00:00:00.000Z", generatePrivateKey());
    expect(await verifyMonthBundle(bundle, bundle.signer)).toBe(true);
    expect(await verifyMonthBundle({...bundle, merchantId:"m_2"}, bundle.signer)).toBe(false);
    expect(await verifyMonthBundle({...bundle, closedAt:"2026-11-02"}, bundle.signer)).toBe(false);
  });
  it("binds every ledger field and its merchant and month", () => {
    const line = {seq:1,amount:"100",description:"Payment",currency:"USDT"};
    const hash = ledgerLineHash("m_1","2026-10",line);
    expect(verifyProof(hash,proofFor(buildTree([hash]),0),hash)).toBe(true);
    for (const changed of [{...line,amount:"101"},{...line,description:"Other"}]) expect(ledgerLineHash("m_1","2026-10",changed)).not.toBe(hash);
    expect(ledgerLineHash("m_2","2026-10",line)).not.toBe(hash);
    expect(ledgerLineHash("m_1","2026-11",line)).not.toBe(hash);
  });
});
