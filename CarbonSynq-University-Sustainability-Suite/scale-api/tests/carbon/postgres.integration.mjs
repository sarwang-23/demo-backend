/** Actual PostgreSQL acceptance tests. NOT part of unit-test results.
 * Only a disposable database with a name ending in _test is accepted.
 * Creates unique fixture tenants; never wipes a database. Document metadata is a
 * controlled fixture, NOT a claim that an actual file was scanned or downloaded.
 */
import assert from 'node:assert/strict';
import {migrate} from '../../scripts/migrate.mjs';
import {createPool,tenantTx,assertRuntimeRole} from '../../src/db.mjs';
import {id,hash,passwordHash} from '../../src/core.mjs';
import {setPeriod} from '../../src/management.mjs';
import {dispatch} from '../../src/university/router.mjs';
import {sourceBody,factorBody,boundaryBody,recordBody,instrumentBody,note} from './memory.mjs';
const ownerUrl=process.env.TEST_DATABASE_ADMIN_URL;
if(!ownerUrl||!new URL(ownerUrl).pathname.endsWith('_test'))throw Error('TEST_DATABASE_ADMIN_URL must name a disposable PostgreSQL database ending in _test. No database integration tests ran.');
const apiPass=process.env.TEST_API_PASSWORD||'only-test-api-password-32-characters',workerPass=process.env.TEST_WORKER_PASSWORD||'only-test-worker-password-32-characters';
process.env.REQUEST_HASH_SECRET='university-integration-only-request-hash-not-production';
await migrate(ownerUrl,{apiPassword:apiPass,workerPassword:workerPass});
const {Client}=await import('pg'),owner=new Client({connectionString:ownerUrl});await owner.connect();
const url=role=>{const u=new URL(ownerUrl);u.username=role;u.password=role==='cs_api'?apiPass:workerPass;return u.href;};
const pool=await createPool({databaseUrl:url('cs_api'),ssl:false,poolMax:10}),worker=await createPool({databaseUrl:url('cs_worker'),ssl:false,poolMax:2});
let count=0;const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
const req=(user,method,path,body={},query={},key='test-'+id())=>dispatch(pool,{user:{...user,requestId:id()},method,path:'/api/v2/university'+path,body,query,key}).then(r=>r.data);
async function fixture(name){const tenant=id(),campus=id(),period=id(),document=id(),people={},encoded=await passwordHash('Only-integration-fixture-password-123!');await owner.query('BEGIN');try{await owner.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);await owner.query('INSERT INTO cs.tenants(id,name) VALUES($1,$2)',[tenant,name]);for(const role of ['ADMIN','ENTRY','REVIEWER','LEADERSHIP']){const uid=id();people[role]={id:uid,tenant_id:tenant,role};await owner.query('INSERT INTO cs.users(id,tenant_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)',[uid,tenant,role.toLowerCase()+'@fixture.example',role,role,encoded]);}await owner.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4)',[campus,tenant,'SYNTHETIC TEST CAMPUS','TEST']);await owner.query('INSERT INTO cs.periods(id,tenant_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5)',[period,tenant,'Synthetic annual period','2026-04-01','2027-03-31']);await owner.query(`INSERT INTO cs.documents(id,tenant_id,original_name,mime_type,file_size,sha256,object_key,object_version,status,scan_result,scan_engine,uploaded_by) VALUES($1,$2,'fixture-only.txt','text/plain',20,$3,$4,'fixture-v1','REVIEW_REQUIRED','CLEAN','TEST_METADATA_NOT_REAL_SCAN',$5)`,[document,tenant,hash('fixture-'+tenant),'fixture/'+id(),people.ENTRY.id]);await owner.query('COMMIT');return {tenant,campus,period,document,...people};}catch(e){await owner.query('ROLLBACK');throw e;}}

try {
 const a=await fixture('Synthetic Test University'),b=await fixture('Other Test University');
 const f={tenant:a.tenant,campus:a.campus,period:a.period,actors:a,document:{id:a.document}};
 const api=(u,m,p,body={},query={},key)=>req(u,m,'/carbon'+p,body,query,key);
 await check('non-owner runtime role and actual RLS',async()=>{await assertRuntimeRole(pool);assert.equal((await pool.query('SELECT * FROM cs.u_c_sources')).rowCount,0);});
 const source=await api(a.ADMIN,'POST','/sources',sourceBody(f,{kind:'PURCHASED_ELECTRICITY',substance:'ELECTRICITY',unit:'kWh'}));
 await check('cross tenant source hidden in real database',()=>assert.rejects(api(b.ADMIN,'GET','/sources/'+source.id),e=>e.code==='NOT_FOUND'));
 await check('RLS without tenant WHERE hides other tenant sources',()=>tenantTx(pool,b.tenant,async c=>assert.equal((await c.query('SELECT * FROM cs.u_c_sources')).rowCount,0)));
 await check('worker cannot read source or instrument data',()=>assert.rejects(worker.query('SELECT * FROM cs.u_c_sources'),e=>e.code==='42501'));
 await check('source immutable at SQL privilege boundary',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query("UPDATE cs.u_c_sources SET name='changed' WHERE id=$1",[source.id])),e=>e.code==='42501'));
 async function approved(use,value){let r=await api(a.ADMIN,'POST','/factors',factorBody({kind:'PURCHASED_ELECTRICITY',substance:'ELECTRICITY',unit:'kWh',use,components:[{gas:'CO2E',massPerUnit:value,gwp:'1'}],...(value==='0'?{zeroReason:note}:{})}));return api(a.REVIEWER,'POST','/factors/'+r.id+'/approve',{version:r.version});}
 const location=await approved('LOCATION','0.7'),residual=await approved('RESIDUAL','0.9'),contract=await approved('MARKET_CONTRACT','0');
 await check('approved factor immutable in PostgreSQL',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query("UPDATE cs.u_c_factors SET source='changed' WHERE id=$1",[location.id])),e=>e.code==='42501'));
 let boundary=await api(a.ADMIN,'POST','/boundaries',boundaryBody(f,[source]));boundary=await api(a.REVIEWER,'POST','/boundaries/'+boundary.id+'/approve',{version:boundary.version});
 await check('period mode activation exists exactly once',()=>tenantTx(pool,a.tenant,async c=>assert.equal((await c.query('SELECT * FROM cs.u_c_period_modes WHERE period_id=$1',[a.period])).rowCount,1)));
 await check('legacy insert guard rejects same-period old ledger before incomplete row can insert',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query("INSERT INTO cs.activities(id,tenant_id,period_id,scope) VALUES($1,$2,$3,'SCOPE_2')",[id(),a.tenant,a.period])),e=>e.code==='23514'));
 await check('legacy university insert guard rejects same-period old ledger',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query("INSERT INTO cs.u_emissions(id,tenant_id,period_id,scope) VALUES($1,$2,$3,'SCOPE_2')",[id(),a.tenant,a.period])),e=>e.code==='23514'));
 let instrument=await api(a.ADMIN,'POST','/instruments',instrumentBody(f,contract.id,{quantityKwh:'40'}));instrument=await api(a.REVIEWER,'POST','/instruments/'+instrument.id+'/approve',{version:instrument.version});
 const body=recordBody(f,source,location,{intervalEnd:'2026-04-30',marketAllocations:[{instrumentId:instrument.id,quantityKwh:'30'}],fallbackFactorId:residual.id,fallbackReason:note});let first;
 await check('idempotent concurrent create returns the same real record',async()=>{const key='scope12-'+id(),r=await Promise.all([api(a.ENTRY,'POST','/records',body,{},key),api(a.ENTRY,'POST','/records',body,{},key)]);assert.equal(r[0].id,r[1].id);first=r[0];});
 await check('overlap check spans concurrent transactions',async()=>{const r=await Promise.allSettled([api(a.ENTRY,'POST','/records',{...body,externalKey:'overlap-a-'+id()}),api(a.ENTRY,'POST','/records',{...body,externalKey:'overlap-b-'+id()})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,0);});
 let second=await api(a.ENTRY,'POST','/records',{...body,externalKey:'second-'+id(),intervalStart:'2026-05-01',intervalEnd:'2027-03-31'});
 first=await api(a.ENTRY,'POST','/records/'+first.id+'/submit',{version:first.version});second=await api(a.ENTRY,'POST','/records/'+second.id+'/submit',{version:second.version});
 let winner,loser;
 await check('parallel approvals cannot over-allocate one certificate',async()=>{const r=await Promise.allSettled([api(a.REVIEWER,'POST','/records/'+first.id+'/approve',{version:first.version}),api(a.REVIEWER,'POST','/records/'+second.id+'/approve',{version:second.version})]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);winner=r.find(x=>x.status==='fulfilled').value;loser=winner.id===first.id?second:first;assert.equal(r.find(x=>x.status==='rejected').reason.code,'INSTRUMENT_EXHAUSTED');});
 await check('primary view includes only location alternative and exact numeric quantity',()=>tenantTx(pool,a.tenant,async c=>{const rows=(await c.query('SELECT kg_co2e,ledger FROM cs.u_inventory WHERE period_id=$1',[a.period])).rows;assert.equal(rows.length,1);assert.equal(rows[0].kg_co2e,'70.000000');assert.equal(rows[0].ledger,'CARBON_SCOPE12');}));
 await check('calculation cannot be deleted through application role',()=>assert.rejects(tenantTx(pool,a.tenant,c=>c.query('DELETE FROM cs.u_c_calculations WHERE record_id=$1',[winner.id])),e=>e.code==='42501'));
 await check('period close refuses missing source coverage and pending records',()=>assert.rejects(setPeriod(pool,a.ADMIN,a.period,{version:1,reason:note},true),e=>e.code==='PENDING_SCOPE12_DATA'));
 let v=await api(a.ENTRY,'POST','/records/'+winner.id+'/request-void',{version:winner.version,reason:note});v=await api(a.REVIEWER,'POST','/voids/'+v.id+'/approve',{version:v.version});
 await check('approved correction releases capacity but keeps calculation history',async()=>{const r=await api(a.REVIEWER,'POST','/records/'+loser.id+'/approve',{version:loser.version});assert.equal(r.calculation.market_kg,'63.000000');await tenantTx(pool,a.tenant,async c=>{assert.equal((await c.query('SELECT * FROM cs.u_c_calculations')).rowCount,2);assert.equal((await c.query('SELECT * FROM cs.u_c_active')).rowCount,1);});});
 await check('migration replay respects original checksums and version 5',async()=>{const m=await migrate(ownerUrl,{apiPassword:apiPass,workerPassword:workerPass});assert.equal(m.version,5);assert.equal(m.alreadyApplied,true);});
 console.log(JSON.stringify({passed:count,postgresql:true,objectStorage:'NOT_TESTED',antivirus:'FIXTURE_METADATA_ONLY',productionCertified:false}));
} finally {await pool.end();await worker.end();await owner.end();}
