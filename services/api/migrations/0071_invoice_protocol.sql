-- Retain v1 obligations while separately indexing the approved v2 deployment.
ALTER TABLE invoices ADD COLUMN contract_version TEXT NOT NULL DEFAULT 'v1';
ALTER TABLE invoices ADD COLUMN router_address TEXT;
ALTER TABLE invoices ADD COLUMN claim_address TEXT;
ALTER TABLE invoices ADD COLUMN payout TEXT;
ALTER TABLE invoices ADD COLUMN payer_lock TEXT;
ALTER TABLE invoices ADD COLUMN min_payment TEXT NOT NULL DEFAULT '0';
ALTER TABLE invoices ADD COLUMN discount_bps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN discount_until INTEGER;
ALTER TABLE invoices ADD COLUMN hook TEXT;
UPDATE invoices SET router_address='0x4c32942616d2BBeDD34bA1178bBF5823FDbbdDC0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE contract_version='v1';
CREATE TRIGGER invoice_protocol_immutable BEFORE UPDATE OF contract_version,router_address,claim_address,payout ON invoices
WHEN NEW.contract_version!=OLD.contract_version
 OR (OLD.router_address IS NOT NULL AND NEW.router_address IS NOT OLD.router_address)
 OR (OLD.claim_address IS NOT NULL AND NEW.claim_address IS NOT OLD.claim_address)
 OR (OLD.payout IS NOT NULL AND NEW.payout IS NOT OLD.payout)
BEGIN SELECT RAISE(ABORT,'immutable invoice provenance'); END;
CREATE TABLE protocol_events(chain_id INTEGER NOT NULL,contract_address TEXT NOT NULL,tx_hash TEXT NOT NULL,log_index INTEGER NOT NULL,PRIMARY KEY(chain_id,contract_address,tx_hash,log_index));
