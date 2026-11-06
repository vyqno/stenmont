-- Staging cutover receipt verified read-only on chain1874, block12390943, status0x1.
-- InvoiceCreated was emitted by this current v1 router for this exact invoice ID.
-- Transaction 0x5078a4c59c938513f61f5f260e145ff2fb9e8cd8a5468f18a7106e5dce8c20d7.
-- This one row landed during the old API's propagation window after0071.
CREATE TABLE _0072_provenance_guard(mismatch INTEGER NOT NULL CHECK(mismatch=0));
INSERT INTO _0072_provenance_guard
SELECT count(*) FROM invoices
WHERE id='0x4bbe5d3eb62c8c05c4983425671ae7c7705e371e4c37ddbe7500f487653590ab'
AND COALESCE((
  lower(create_tx_hash)='0x5078a4c59c938513f61f5f260e145ff2fb9e8cd8a5468f18a7106e5dce8c20d7'
  AND contract_version='v1'
  AND ((router_address IS NULL AND claim_address IS NULL)
    OR (lower(router_address)='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0'
      AND lower(claim_address)='0x2eb9aaf14a2d729bc3f185a144571fcd23454914'))
),0)=0;
DROP TABLE _0072_provenance_guard;
UPDATE invoices
SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',
    claim_address='0x2eb9aaf14a2d729bc3f185a144571fcd23454914'
WHERE id='0x4bbe5d3eb62c8c05c4983425671ae7c7705e371e4c37ddbe7500f487653590ab'
  AND lower(create_tx_hash)='0x5078a4c59c938513f61f5f260e145ff2fb9e8cd8a5468f18a7106e5dce8c20d7'
  AND contract_version='v1' AND router_address IS NULL AND claim_address IS NULL;
