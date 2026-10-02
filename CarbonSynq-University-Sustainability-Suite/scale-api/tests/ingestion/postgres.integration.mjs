/** Real PostgreSQL ingestion acceptance. NOT executed in the delivery environment.
 * Only a disposable database with a name ending in _test is accepted.
 * Creates unique fixture tenants; never wipes a database. Document metadata is a
 * controlled fixture, NOT a claim that an actual file was scanned or downloaded.
 */
import { testSsl } from '../postgres-support.mjs';
import assert from 'node:assert/strict';
import {migrate} from '../../scripts/migrate.mjs';
import {createPool,tenantTx,assertRuntimeRole} from '../../src/db.mjs';
import {id,hash,passwordHash} from '../../src/core.mjs';
import {dispatch} from '../../src/university/router.mjs';
import {readFile} from 'node:fs/promises';
import {parseFile,XLSX_MIME} from '../../src/ingestion/parser.mjs';
const ownerUrl=process.env.TEST_DATABASE_ADMIN_URL;
if(!ownerUrl||!new URL(ownerUrl).pathname.endsWith('_test'))throw Error('TEST_DATABASE_ADMIN_URL must name a disposable PostgreSQL database ending in _test. No database integration tests ran.');
const apiPass=process.env.TEST_API_PASSWORD||'only-test-api-password-32-characters',workerPass=process.env.TEST_WORKER_PASSWORD||'only-test-worker-password-32-characters';
process.env.REQUEST_HASH_SECRET='university-integration-only-request-hash-not-production';
const ssl=testSsl();
await migrate(ownerUrl,{apiPassword:apiPass,workerPassword:workerPass,ssl});
const {Client}=await import('pg'),owner=new Client({connectionString:ownerUrl,ssl});await owner.connect();
const url=role=>{const u=new URL(ownerUrl);u.username=role;u.password=role==='cs_api'?apiPass:workerPass;return u.href;};
const pool=await createPool({databaseUrl:url('cs_api'),ssl,poolMax:10}),worker=await createPool({databaseUrl:url('cs_worker'),ssl,poolMax:2});
let count=0;const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
const req=(user,method,path,body={},query={},key='test-'+id())=>dispatch(pool,{user:{...user,requestId:id()},method,path:'/api/v2/university'+path,body,query,key}).then(r=>r.data);
async function fixture(name){const tenant=id(),campus=id(),period=id(),document=id(),people={},encoded=await passwordHash('Only-integration-fixture-password-123!');await owner.query('BEGIN');try{await owner.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);await owner.query('INSERT INTO cs.tenants(id,name) VALUES($1,$2)',[tenant,name]);for(const role of ['ADMIN','ENTRY','REVIEWER','LEADERSHIP']){const uid=id();people[role]={id:uid,tenant_id:tenant,role};await owner.query('INSERT INTO cs.users(id,tenant_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[uid,tenant,role.toLowerCase()+'@fixture.example',role,role,encoded]);}await owner.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4)',[campus,tenant,'SYNTHETIC TEST CAMPUS','TEST']);await owner.query('INSERT INTO cs.periods(id,tenant_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5)',[period,tenant,'Synthetic annual period','2026-04-01','2027-03-31']);await owner.query(`INSERT INTO cs.documents(id,tenant_id,original_name,mime_type,file_size,sha256,object_key,object_version,status,scan_result,scan_engine,uploaded_by) VALUES($1,$2,'fixture-only.txt','text/plain',20,$3,$4,'fixture-v1','REVIEW_REQUIRED','CLEAN','TEST_METADATA_NOT_REAL_SCAN',$5)`,[document,tenant,hash('fixture-'+tenant),'fixture/'+id(),people.ENTRY.id]);await owner.query('COMMIT');return {tenant,campus,period,document,...people};}catch(e){await owner.query('ROLLBACK');throw e;}}

try {
 const a=await fixture('Synthetic Import Acceptance'),b=await fixture('Tenant Isolation Fixture');
 await assertRuntimeRole(pool);
 const api=(actor,method,path,body={},query={},key)=>req(actor,method,path,body,query,key);
 const ingestion=(actor,method,path,body={},query={},key)=>api(actor,method,'/ingestion'+path,body,query,key);
 await check('new tables enforce and force PostgreSQL RLS',async()=>{const r=await owner.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('cs.u_i_batches'::regclass,'cs.u_i_files'::regclass,'cs.u_i_rows'::regclass,'cs.u_i_templates'::regclass)");assert.equal(r.rowCount,4);assert.ok(r.rows.every(x=>x.relrowsecurity&&x.relforcerowsecurity));});
 await check('background worker cannot mutate reviewed import rows',()=>assert.rejects(worker.query("UPDATE cs.u_i_rows SET review_reason='unauthorized'"),e=>e.code==='42501'));
 const extraction=await parseFile(Buffer.from('Consumption,Unit,Period start,Period end\n2.5,KL,2026-04-01,2026-04-30\n'),'csv');
 await owner.query('BEGIN');try{await owner.query("SELECT set_config('app.tenant_id',$1,true)",[a.tenant]);await owner.query("UPDATE cs.documents SET original_name='synthetic.csv',mime_type='text/csv',extraction=$1::jsonb WHERE id=$2",[JSON.stringify(extraction),a.document]);await owner.query('COMMIT');}catch(e){await owner.query('ROLLBACK');throw e;}
 const k=await api(a.ADMIN,'POST','/kpis',{code:'IMPORT_WATER',name:'Import acceptance water',domain:'WATER',unit:'m3',aggregation:'SUM',evidenceRequired:true,guidance:'Synthetic acceptance KPI, not a real environmental report.'});
 const t=await api(a.ADMIN,'POST','/tasks',{periodId:a.period,campusId:a.campus,kpiId:k.id,assigneeId:a.ENTRY.id,reviewerId:a.REVIEWER.id,bucket:'2026-04',intervalStart:'2026-04-01',intervalEnd:'2026-04-30',dueDate:'2026-05-15'});
 const batch=await ingestion(a.ENTRY,'POST','/batches',{name:'Actual SQL acceptance',kind:'SPREADSHEET',target:'KPI',periodId:a.period});
 await check('cross-tenant API cannot read batch',()=>assert.rejects(ingestion(b.ADMIN,'GET','/batches/'+batch.id),e=>e.code==='NOT_FOUND'));
 await check('SQL without tenant predicate is isolated',()=>tenantTx(pool,b.tenant,async c=>assert.equal((await c.query('SELECT * FROM cs.u_i_batches WHERE id=$1',[batch.id])).rowCount,0)));
 const attached=await ingestion(a.ENTRY,'POST','/batches/'+batch.id+'/files',{version:batch.version,documentIds:[a.document]});
 const preview=await ingestion(a.ENTRY,'POST','/files/'+attached.files[0].id+'/preview',{version:1,plans:[{sheet:extraction.sheets[0].name,headerRow:1,mapping:{quantity:'A',unit:'B',intervalStart:'C',intervalEnd:'D'},defaults:{taskId:t.id},dateOrder:'AUTO'}]});
 await check('actual SQL staging normalizes KL to KPI cubic metres',async()=>{assert.equal(preview.rows.length,1);assert.equal(preview.rows[0].normalized.quantity,'2.500000');assert.equal(preview.rows[0].normalized.unit,'m3');assert.equal(preview.rows[0].status,'REVIEW');});
 await check('SQL provenance trigger rejects raw source edits',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query("UPDATE cs.u_i_rows SET raw_values='{}'::jsonb WHERE id=$1",[preview.rows[0].id])),e=>e.code==='23514'));
 const reviewed=await ingestion(a.ENTRY,'POST','/batches/'+batch.id+'/review',{quantityMeaningConfirmed:true,items:[{rowId:preview.rows[0].id,version:preview.rows[0].version,action:'CONFIRM',reason:'Checked the synthetic original CSV and assigned task.'}]});
 const current=await ingestion(a.ENTRY,'GET','/batches/'+batch.id),body={version:current.version,confirmed:true,rowIds:reviewed.items.map(x=>x.id)},idem='commit-'+id();
 const imported=await ingestion(a.ENTRY,'POST','/batches/'+batch.id+'/commit',body,{},idem);
 await check('commit creates only one draft with original evidence',()=>tenantTx(pool,a.tenant,async c=>{const r=await c.query('SELECT * FROM cs.u_submissions WHERE id=$1',[imported.receipts[0].recordId]);assert.equal(r.rows[0].status,'DRAFT');assert.equal(r.rows[0].value,'2.500000');}));
 await check('exact request retry returns same receipt',async()=>{const again=await ingestion(a.ENTRY,'POST','/batches/'+batch.id+'/commit',body,{},idem);assert.equal(again.receipts[0].recordId,imported.receipts[0].recordId);});
 await check('imported receipts cannot be edited by API database role',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query("UPDATE cs.u_i_rows SET review_reason='changed' WHERE id=$1",[preview.rows[0].id])),e=>e.code==='23514'));
 await check('one immutable import receipt exists',()=>tenantTx(pool,a.tenant,async c=>assert.equal((await c.query("SELECT * FROM cs.u_i_rows WHERE batch_id=$1 AND status='IMPORTED'",[batch.id])).rowCount,1)));
 await check('migration replay retains checksums at version 6',async()=>assert.equal((await migrate(ownerUrl,{apiPassword:apiPass,workerPassword:workerPass,ssl})).version,6));
 console.log(JSON.stringify({passed:count,postgresql:true,objectStorage:'NOT_TESTED',antivirus:'FIXTURE_METADATA_ONLY',productionCertified:false}));
}finally{await pool.end();await worker.end();await owner.end();}
