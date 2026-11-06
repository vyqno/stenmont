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
-- Receipt-classified staging inventory at chain1874 block12389975; no receipt means no inferred deployment.
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0xfb846c0c72f854b543120e0b90549cc462acb5f3f621644ae2935ecd61e19256' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x060154322bead1e407fc5d59411594c33abddeb70863601a57e7bc868f7dc6d3' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0xf2c9da78c84aefadde711d1c3d864f9fc5b7afc554da1b7c9ede9f03f4a5dee7' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x0fa77268afe950030c204c3ca2c9158fd3a3fbc3e7798ccd250abfab7577e429' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0xc588ae091e9b52d429f915942c89a3ae5c6c93100cdd1d43c04a86863696cb4a' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x6c19770796e9ca4908cbe5b9d008af93086aa4cd3f4d6ed2cd0baa4521a11fe6' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x56019a39504a57582206e086c45f32002f5fe5778b898be2c48af961c01f0cc0' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x9dfe758ccf0ea7023edf7092532b29b0cb1a12d504ba08436f6f17ed1b9bfcc2' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x85a331e3ccf7e96fd72a4df7ab85563518576d55e3e270ed280b38de67f53672' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x310f54447597a0a5441206ccabbac653f43ae297c56b904586c7636862987f37' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x593bdc27981fab9c7c392af6c90574da284a0a8d388256bf9864444090f38769' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x40c07ccf541fafeb68b18ba1a76ecc382b63dd84df48eec1b988cff512639855' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x32fff63d606d7cb199f33cc7230320e3a1d316422ec0a7126110d64387437d88' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x21c6e67cb1572e631a4f5ec4e3c79e2ba9cb46ddccc5c778bde873c429e66303' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0x2ae5e11de71d6003003094d5d912dd2dbc86eb49e7e599c7316e5581945fc0db' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0xa4d2a0c580f2c4b4b888f6f68efd5c81917b98eb6add2b11a4735265e73c5b51' AND contract_version='v1';
UPDATE invoices SET router_address='0xa5b6c9206db75fd59307bd22f7703387bb8ab929',claim_address=NULL WHERE id='0xab25c01df047f345781030d549464b8e9eaca258316a9e03cbb0489c601ae2be' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0x2fd6429ed18f8149ac6b910b6563c8328976919372ef0632cde1d20ea53d4f1e' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0x70b7a96064b038a1c914358162ca78ca2157154253663fa01f90b1c6040a71f8' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0x640546236a89ba9ed93cc49f97f7dc2322501dffbd2f181b0d1e09b9d7afd377' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0x3740104aa4957dd307ad783d2bc77023cc3e9d3ac39d0e9d3c5e664456e2cafe' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0xb5ce2eb038b09cbd59b7b71b320b99571e884bb6eadb58aaec9a93c1da672631' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0xb500fd67a275d451d0546243fecaf55caaeb5af35a846f2c7172b254df4cce36' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0xe17c6c37432b86492f12f14be0187c0a23adf281963a7bab4b6ad7685fd1d727' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0xa1dd9d1cb016748f57f03b4c471f7834cf75b5285c719339e4e816487f109dd3' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0xaff2d503cf93b0b4d589f9e5e91db942cd14db355b7b8dd8ed6163763ebd6763' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0xd4a49580face3a40c32ca6f4eecde0a6aa6c45f676e560d11fdb9fa68648d350' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0xb296ecb9c1cdb0f371a6ddb7444a0b1f0c0bb56f0904fdbe1c92d0f97eba6636' AND contract_version='v1';
UPDATE invoices SET router_address='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim_address='0x2EB9aaF14A2d729BC3F185A144571fCd23454914' WHERE id='0x7bdcc5c7e53450f4643208c233a4f5dc4d4e356f94366cd217ec37078771db80' AND contract_version='v1';
-- Abort if creation raced the receipt inventory or any successful obligation was not classified.
CREATE TABLE _0071_classification_guard(unclassified INTEGER NOT NULL CHECK(unclassified=0));
INSERT INTO _0071_classification_guard SELECT count(*) FROM invoices WHERE router_address IS NULL AND (status!='failed' OR create_tx_hash IS NOT NULL);
DROP TABLE _0071_classification_guard;
CREATE TRIGGER invoice_protocol_immutable BEFORE UPDATE OF contract_version,router_address,claim_address,payout ON invoices
WHEN NEW.contract_version!=OLD.contract_version
 OR (OLD.router_address IS NOT NULL AND NEW.router_address IS NOT OLD.router_address)
 OR (OLD.claim_address IS NOT NULL AND NEW.claim_address IS NOT OLD.claim_address)
 OR (OLD.payout IS NOT NULL AND NEW.payout IS NOT OLD.payout)
BEGIN SELECT RAISE(ABORT,'immutable invoice provenance'); END;
CREATE TABLE protocol_events(chain_id INTEGER NOT NULL,contract_address TEXT NOT NULL,tx_hash TEXT NOT NULL,log_index INTEGER NOT NULL,PRIMARY KEY(chain_id,contract_address,tx_hash,log_index));
