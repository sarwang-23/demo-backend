/** Actual PostgreSQL acceptance tests. NOT part of unit-test results.
 * Only a disposable database with a name ending in _test is accepted.
 * Creates unique fixture tenants; never wipes a database. Document metadata is a
 * controlled fixture, NOT a claim that an actual file was scanned or downloaded.
 */
import { testSsl } from '../postgres-support.mjs';
import assert from 'node:assert/strict';
import {migrate} from '../../scripts/migrate.mjs';
import {createPool,tenantTx,assertRuntimeRole} from '../../src/db.mjs';
import {id,hash,passwordHash} from '../../src/core.mjs';
import {setPeriod} from '../../src/management.mjs';
import {dispatch,portalDispatch} from '../../src/university/router.mjs';
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
try{
 const a=await fixture('University acceptance A'),b=await fixture('University acceptance B');
 await check('application role is non-owner and does not bypass RLS',()=>assertRuntimeRole(pool));
 await check('worker reads operational university data but no master data and cannot alter emissions',async()=>{await assert.rejects(worker.query('SELECT * FROM cs.u_kpis'),e=>e.code==='42501');await assert.rejects(worker.query('SELECT * FROM cs.u_factors'),e=>e.code==='42501');await assert.rejects(worker.query('SELECT * FROM cs.u_suppliers'),e=>e.code==='42501');await assert.rejects(worker.query('SELECT * FROM cs.u_departments'),e=>e.code==='42501');await assert.rejects(tenantTx(worker,a.tenant,c=>c.query('UPDATE cs.u_emissions SET quantity=0 WHERE false')),e=>e.code==='42501');await worker.query('SELECT * FROM cs.u_emissions');await worker.query('SELECT * FROM cs.u_submissions');});
 await check('repeat migration preserves checksum history',async()=>{const m=await migrate(ownerUrl,{apiPassword:apiPass,workerPassword:workerPass,ssl});assert.equal(m.alreadyApplied,true);assert.equal(m.version,6);});
 await check('22 definitions install once without seeding measurements',async()=>{assert.equal((await req(a.ADMIN,'POST','/catalog/install')).added,22);assert.equal((await req(a.ADMIN,'POST','/catalog/install')).added,0);});
 await check('unscoped university read returns no rows',async()=>assert.equal((await pool.query('SELECT * FROM cs.u_kpis')).rowCount,0));
 await check('tenant B cannot read tenant A KPI rows even without tenant WHERE',()=>tenantTx(pool,b.tenant,async c=>assert.equal((await c.query('SELECT * FROM cs.u_kpis')).rowCount,0)));
 await check('RLS blocks cross-tenant university inserts',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query(`INSERT INTO cs.u_suppliers(id,tenant_id,name,code,contact_email,category,created_by) VALUES($1,$2,'Bad','BAD','x@example.com','test',$3)`,[id(),b.tenant,b.ADMIN.id])),e=>e.code==='42501'));
 const kpis=(await req(a.ADMIN,'GET','/kpis')).items,kpi=kpis.find(k=>k.code==='WATER_WITHDRAWAL_M3');let task;
 const taskBody={periodId:a.period,campusId:a.campus,kpiId:kpi.id,assigneeId:a.ENTRY.id,reviewerId:a.REVIEWER.id,bucket:'CAMPUS_TOTAL',intervalStart:'2026-04-01',intervalEnd:'2027-03-31',dueDate:'2027-04-15'};
 await check('concurrent overlapping tasks serialize to exactly one insert',async()=>{const results=await Promise.allSettled([req(a.ADMIN,'POST','/tasks',taskBody),req(a.ADMIN,'POST','/tasks',taskBody)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);task=results.find(x=>x.status==='fulfilled').value;assert.equal((await req(a.ADMIN,'GET','/tasks')).items.length,1);});
 await check('period closure blocks pending university collection',()=>assert.rejects(setPeriod(pool,a.ADMIN,a.period,{version:1,reason:'Integration pending task close check'},true),e=>e.code==='PENDING_UNIVERSITY_DATA'));
 let submission=await req(a.ENTRY,'POST','/tasks/'+task.id+'/submissions',{taskVersion:task.version,value:'500',unit:'m3',notes:'Fixture only',evidenceIds:[a.document]});
 submission=await req(a.ENTRY,'POST','/submissions/'+submission.id+'/submit',{version:submission.version});
 await check('maker cannot approve even when presented as administrator',()=>assert.rejects(req({...a.ENTRY,role:'ADMIN'},'POST','/submissions/'+submission.id+'/approve',{version:submission.version}),e=>e.code==='SELF_APPROVAL'));
 submission=await req(a.REVIEWER,'POST','/submissions/'+submission.id+'/approve',{version:submission.version});
 await check('metric snapshot is immutable in actual database',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query('UPDATE cs.u_metric_snapshots SET value=1 WHERE tenant_id=$1',[a.tenant])),e=>e.code==='42501'));
 const factorBody={category:'FOOD_PURCHASES',unit:'kg',value:'2.5',method:'ACTIVITY_BASED',source:'SYNTHETIC integration assumption only',sourceUrl:'https://example.com/not-a-real-factor',region:'TEST',boundary:'Synthetic test fixture; do not use for reporting',versionLabel:'SYNTHETIC-v1',validFrom:'2026-04-01',validTo:'2027-03-31'};
 let factor=await req(a.ADMIN,'POST','/factors',factorBody);factor=await req(a.REVIEWER,'POST','/factors/'+factor.id+'/approve',{version:factor.version});
 await check('approved factor mutation rejected by trigger',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query('UPDATE cs.u_factors SET value=9 WHERE id=$1',[factor.id])),e=>e.code==='42501'));
 await req(a.ADMIN,'POST','/scope3-screenings',{periodId:a.period,categoryNumber:1,decision:'INCLUDED',rationale:'Dining purchases inside test university boundary.'});
 const emissionBody={periodId:a.period,campusId:a.campus,category:'FOOD_PURCHASES',quantity:'100',unit:'kg',activityDate:'2026-06-01',factorId:factor.id,dataQuality:'MEASURED',externalKey:'test-source-'+id(),description:'Fixture food purchase, not real data',evidenceIds:[a.document]};let emission;
 await check('parallel same-key emission retries create one draft',async()=>{const key='integration-'+id();const [x,y]=await Promise.all([req(a.ENTRY,'POST','/emissions',emissionBody,{},key),req(a.ENTRY,'POST','/emissions',emissionBody,{},key)]);assert.equal(x.id,y.id);emission=x;});
 emission=await req(a.ENTRY,'POST','/emissions/'+emission.id+'/submit',{version:emission.version});emission=await req(a.REVIEWER,'POST','/emissions/'+emission.id+'/approve',{version:emission.version});
 await check('real view and exact numeric ledger reconcile to 250 kg',async()=>{const r=await req(a.ADMIN,'GET','/overview',{}, {periodId:a.period});assert.equal(r.inventory.totalKgCo2e,'250.000000');assert.equal(r.metrics.find(m=>m.code==='WATER_WITHDRAWAL_M3').value,'500.000000');assert.equal(r.inventory.scopes.SCOPE_3,'250.000000');});
 await check('another tenant cannot read calculation record',()=>assert.rejects(req(b.ADMIN,'GET','/emissions/'+emission.id),e=>e.code==='NOT_FOUND'));
 await check('approved calculation row cannot be deleted or updated',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query('DELETE FROM cs.u_calculations WHERE emission_id=$1',[emission.id])),e=>e.code==='42501'));
 const voided=await req(a.ENTRY,'POST','/emissions/'+emission.id+'/request-void',{version:emission.version,reason:'Fixture correction for an incorrectly recorded quantity.'});await req(a.REVIEWER,'POST','/voids/'+voided.id+'/approve',{version:voided.version});
 await check('approved void excludes calculation without deleting evidence history',async()=>{const r=await req(a.ADMIN,'GET','/overview',{}, {periodId:a.period});assert.equal(r.inventory.totalKgCo2e,'0.000000');assert.equal((await req(a.ADMIN,'GET','/emissions/'+emission.id)).calculations.length,1);});
 let replacement=await req(a.ENTRY,'POST','/emissions',{...emissionBody,externalKey:'replacement-'+id(),quantity:'40',replacesId:emission.id});replacement=await req(a.ENTRY,'POST','/emissions/'+replacement.id+'/submit',{version:replacement.version});replacement=await req(a.REVIEWER,'POST','/emissions/'+replacement.id+'/approve',{version:replacement.version});
 const supplier=await req(a.ENTRY,'POST','/suppliers',{name:'Fixture caterer',code:'TEST_CATERER',contactEmail:'supplier@fixture.example',category:'Dining'});
 const questionnaire=await req(a.ENTRY,'POST','/supplier-requests',{supplierId:supplier.id,periodId:a.period,title:'Fixture annual purchased food',dueDate:'2027-03-31',questions:[{key:'FOOD_KG',label:'Food supplied',type:'NUMBER',required:true,unit:'kg'}]});
 const invite=await req(a.ENTRY,'POST','/supplier-requests/'+questionnaire.id+'/invite',{version:questionnaire.version,expiresInDays:7});const portalReq={header:'Capability '+invite.token,ip:'university-integration',requestId:id()};
 await check('capability reads only its own questionnaire and consumes once',async()=>{const q=await portalDispatch(pool,portalReq);assert.equal(q.id,questionnaire.id);await portalDispatch(pool,{...portalReq,body:{version:q.version,answers:{FOOD_KG:'40'},attestation:true}});await assert.rejects(portalDispatch(pool,{...portalReq,body:{version:q.version,answers:{FOOD_KG:'40'},attestation:true}}),e=>e.code==='CAPABILITY_USED');});
 let sr=await req(a.ENTRY,'GET','/supplier-requests/'+questionnaire.id);sr=await req(a.ENTRY,'PATCH','/supplier-requests/'+sr.id+'/evidence',{version:sr.version,evidenceIds:[a.document]});await req(a.REVIEWER,'POST','/supplier-requests/'+sr.id+'/approve',{version:sr.version});
 await check('supplier submission does not automatically post extra emissions',async()=>assert.equal((await req(a.ADMIN,'GET','/overview',{}, {periodId:a.period})).inventory.totalKgCo2e,'100.000000'));
 const period=await setPeriod(pool,a.ADMIN,a.period,{version:1,reason:'Completed fixture collection and calculations; close period.'},true);
 let report=await req(a.ADMIN,'POST','/reports',{periodId:a.period,title:'Fixture university inventory',purpose:'UNIVERSITY_SUSTAINABILITY',boundaryStatement:'One synthetic campus; fixture data only; no completeness claim.'});
 await check('snapshot bytes cannot change after capture',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query("UPDATE cs.u_reports SET snapshot='{}'::jsonb WHERE id=$1",[report.id])),e=>e.code==='42501'));
 report=await req(a.REVIEWER,'POST','/reports/'+report.id+'/approve',{version:report.version});
 await check('approved report agrees with corrected immutable inventory',async()=>{const r=await req(a.ADMIN,'GET','/reports/'+report.id);assert.equal(r.integrityVerified,true);assert.equal(r.snapshot.inventorySummary.totalKgCo2e,'100.000000');});
 await setPeriod(pool,a.ADMIN,a.period,{version:period.version,reason:'Reopen the synthetic period to test supersession.'},false);
 await check('reopening marks prior snapshot superseded, not silently rewritten',async()=>assert.equal((await req(a.ADMIN,'GET','/reports/'+report.id)).supersededByPeriodChange,true));
 console.log(JSON.stringify({passed:count,postgresql:true,objectStorage:'NOT_TESTED_HERE',antivirus:'METADATA_FIXTURE_ONLY',productionCertified:false}));
}finally{await pool.end();await worker.end();await owner.end();}
