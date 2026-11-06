import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const id='0x4bbe5d3eb62c8c05c4983425671ae7c7705e371e4c37ddbe7500f487653590ab',tx='0x5078a4c59c938513f61f5f260e145ff2fb9e8cd8a5468f18a7106e5dce8c20d7';
const router='0x4c32942616d2bbedd34ba1178bbf5823fdbbddc0',claim='0x2eb9aaf14a2d729bc3f185a144571fcd23454914';
const sql=()=>readFileSync(new URL('../../migrations/0072_cutover_provenance.sql',import.meta.url),'utf8');
function world(hash:string|null=tx,pinned:string|null=null){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE invoices(id TEXT PRIMARY KEY,create_tx_hash TEXT,contract_version TEXT,router_address TEXT,claim_address TEXT,status TEXT,amount_paid TEXT)');
 db.prepare('INSERT INTO invoices VALUES(?,?,?,?,?,?,?)').run(id,hash,'v1',pinned,null,'open','0');
 db.prepare('INSERT INTO invoices VALUES(?,?,?,?,?,?,?)').run('failed-with-no-transaction',null,'v1',null,null,'failed','0');return db;
}
it('classifies only the exact verified creation and preserves the failed no-transaction row',()=>{
 const db=world();db.exec(sql());expect(db.prepare('SELECT * FROM invoices WHERE id=?').get(id)).toMatchObject({create_tx_hash:tx,contract_version:'v1',router_address:router,claim_address:claim,status:'open',amount_paid:'0'});
 expect(db.prepare('SELECT * FROM invoices WHERE id=?').get('failed-with-no-transaction')).toMatchObject({router_address:null,claim_address:null,status:'failed'});
});
it('is idempotent after correct classification',()=>{const db=world();db.exec(sql());db.exec(sql());expect(db.prepare('SELECT router_address FROM invoices WHERE id=?').get(id)).toMatchObject({router_address:router});});
it.each(['wrong-creation-hash',null])('rejects mismatched or absent creation receipt provenance: %s',hash=>{const db=world(hash);expect(()=>db.exec(sql())).toThrow();expect(db.prepare('SELECT router_address FROM invoices WHERE id=?').get(id)).toMatchObject({router_address:null});});
it('refuses to overwrite an assigned router',()=>{const db=world(tx,'0xa5b6c9206db75fd59307bd22f7703387bb8ab929');expect(()=>db.exec(sql())).toThrow();expect(db.prepare('SELECT router_address FROM invoices WHERE id=?').get(id)).toMatchObject({router_address:'0xa5b6c9206db75fd59307bd22f7703387bb8ab929'});});
it('does nothing in an environment without this invoice',()=>{const db=world();db.prepare('DELETE FROM invoices WHERE id=?').run(id);db.exec(sql());expect(db.prepare('SELECT count(*) n FROM invoices').get()).toMatchObject({n:1});});
