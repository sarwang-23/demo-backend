import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDemoServer} from '../server.mjs';
import {openDatabase,passwordHash} from '../lib/db.mjs';
import {sha256} from '../lib/shared.mjs';
let server,db,base,meta;const tokens={};let serial=17000;
const OTHER='99999999-9999-4999-8999-999999999999';
async function request(route,{actor='entry',method='GET',body,form,headers={}}={}) {
 const h={...headers};if(actor&&tokens[actor])h.Authorization='Bearer '+tokens[actor];
 let payload=form;
 if(body!==undefined){h['Content-Type']='application/json';payload=JSON.stringify(body);}
 const response=await fetch(base+route,{method,headers:h,...(payload===undefined?{}:{body:payload})});
 const output=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
 return {status:response.status,body:output,data:output?.data,headers:response.headers};
}
function activity(extra={}) {
 const campus=meta.campuses.find(c=>c.name==='North Campus');
 const building=meta.buildings.find(b=>b.campusId===campus.id&&b.name==='Academic Block');
 return {reportingPeriodId:meta.reportingPeriods[0].id,campusId:campus.id,buildingId:building.id,category:'PURCHASED_ELECTRICITY',quantity:serial++,unit:'kWh',activityDate:'2026-10-02',description:'Integration test consumption',...extra};
}
async function create(extra={},actor='entry'){const r=await request('/api/v1/activity-data',{actor,method:'POST',body:activity(extra)});assert.equal(r.status,201,JSON.stringify(r.body));return r.data;}
async function step(a,action,actor='reviewer',extra={}) {
 const r=await request(`/api/v1/activity-data/${a.id}/${action}`,{actor,method:'POST',body:{version:a.version,...extra}});assert.equal(r.status,200,JSON.stringify(r.body));return r.data;
}
function fileForm(name='sample-electricity.pdf',content=null,type='application/pdf') {
 const data=content??readFileSync(new URL('../samples/'+name,import.meta.url));const form=new FormData();form.set('file',new Blob([data],{type}),name);return form;
}
before(async()=>{
 ({server,db}=createDemoServer({dbPath:':memory:',quiet:true}));
 db.prepare('UPDATE users SET password_hash=? WHERE university_id=?').run(passwordHash('IsolationPass123!'),OTHER);
 db.prepare('INSERT INTO campuses VALUES (?,?,?,?)').run('other-campus',OTHER,'Isolated Campus','ISO');
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
 for(const actor of ['admin','entry','reviewer','ceo','isolation']) {
  const r=await request('/api/v1/auth/login',{actor:null,method:'POST',body:{email:`${actor}@carbonsynq.demo`,password:actor==='isolation'?'IsolationPass123!':'Demo@12345'}});
  assert.equal(r.status,200,JSON.stringify(r.body));tokens[actor]=r.data.token;
 }
 meta=(await request('/api/v1/meta')).data;
});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});

test('health and static UI are served without external infrastructure',async()=>{
 const health=await request('/health',{actor:null});assert.equal(health.status,200);assert.equal(health.data.database,'connected');
 const ui=await request('/',{actor:null});assert.equal(ui.status,200);assert.match(ui.body,/CarbonSynq/);assert.match(ui.headers.get('content-security-policy'),/script-src 'self'/);
});
test('invalid credentials and anonymous access fail',async()=>{
 assert.equal((await request('/api/v1/auth/login',{actor:null,method:'POST',body:{email:'admin@carbonsynq.demo',password:'wrong'}})).status,401);
 for(const route of ['/api/v1/meta','/api/v1/activity-data','/api/v1/documents','/api/v1/reports/summary'])assert.equal((await request(route,{actor:null})).status,401);
});
test('leadership and reviewer cannot create consumption',async()=>{
 for(const actor of ['ceo','reviewer'])assert.equal((await request('/api/v1/activity-data',{actor,method:'POST',body:activity()})).status,403);
});
test('metadata and explicit university filters are tenant-scoped',async()=>{
 assert.equal(meta.university.name,'Greenfield University');assert.equal(meta.campuses.length,2);assert.equal(meta.buildings.length,6);
 const other=(await request('/api/v1/meta',{actor:'isolation'})).data;assert.equal(other.university.id,OTHER);assert.equal(other.campuses.length,1);
 assert.equal((await request('/api/v1/activity-data?universityId='+OTHER)).status,403);
});
test('hierarchy, ownership, scope, units and date validation reject invalid inputs',async()=>{
 const southBuilding=meta.buildings.find(b=>b.campusId!==meta.campuses.find(c=>c.name==='North Campus').id);
 for(const invalid of [{campusId:'other-campus'},{buildingId:southBuilding.id},{scope:'SCOPE_1'},{unit:'INR'},{activityDate:'2026-02-31'},{activityDate:'2028-01-01'},{quantity:0},{quantity:-4},{quantity:'100'},{quantity:1.00001}]) {
  const r=await request('/api/v1/activity-data',{method:'POST',body:activity(invalid)});assert.equal(r.status,422,JSON.stringify({invalid,result:r.body}));
 }
 const foreignPeriod=db.prepare('SELECT id FROM reporting_periods WHERE university_id=?').get(OTHER).id;
 assert.equal((await request('/api/v1/activity-data',{method:'POST',body:activity({reportingPeriodId:foreignPeriod})})).status,422);
});
test('preview is read-only and drafts do not change dashboard emissions',async()=>{
 const before=(await request('/api/v1/dashboard')).data;
 const body=activity({quantity:1250});const p=await request('/api/v1/activity-data/preview',{method:'POST',body});
 assert.equal(p.status,200);assert.equal(p.data.kgCO2e,887.5);assert.equal(p.data.demoOnly,true);
 assert.equal((await request('/api/v1/dashboard')).data.totalActivities,before.totalActivities);
 const saved=await request('/api/v1/activity-data',{method:'POST',body});assert.equal(saved.data.status,'DRAFT');
 assert.equal((await request('/api/v1/dashboard')).data.totalKgCO2e,before.totalKgCO2e);
});
test('idempotency handles replay and conflicting payloads',async()=>{
 const body=activity();const headers={'Idempotency-Key':'integration-repeat'};
 const [one,two]=await Promise.all([request('/api/v1/activity-data',{method:'POST',body,headers}),request('/api/v1/activity-data',{method:'POST',body,headers})]);
 assert.equal(one.status,201);assert.equal(two.status,201);assert.equal(one.data.id,two.data.id);
 assert.equal((await request('/api/v1/activity-data',{method:'POST',body:{...body,quantity:body.quantity+1},headers})).status,409);
});
test('duplicate detection needs explicit justification for separate records',async()=>{
 const body=activity();assert.equal((await request('/api/v1/activity-data',{method:'POST',body})).status,201);
 const duplicate=await request('/api/v1/activity-data',{method:'POST',body});assert.equal(duplicate.status,409);assert.equal(duplicate.body.error.code,'POSSIBLE_DUPLICATE');
 assert.equal((await request('/api/v1/activity-data',{method:'POST',body:{...body,allowDuplicate:true}})).status,409);
 assert.equal((await request('/api/v1/activity-data',{method:'POST',body:{...body,allowDuplicate:true,duplicateReason:'Different meter MTR-002; separate reading.'}})).status,201);
});
test('editing cannot bypass duplicate safeguards and unchanged self-edit is allowed',async()=>{
 const a=await create(),b=await create();
 let r=await request(`/api/v1/activity-data/${b.id}`,{method:'PATCH',body:{version:b.version,quantity:a.quantity}});
 assert.equal(r.status,409);assert.equal(r.body.error.code,'POSSIBLE_DUPLICATE');
 r=await request(`/api/v1/activity-data/${b.id}`,{method:'PATCH',body:{version:b.version,description:'Ordinary non-duplicate correction'}});
 assert.equal(r.status,200);
 r=await request(`/api/v1/activity-data/${b.id}`,{method:'PATCH',body:{version:r.data.version,quantity:a.quantity,allowDuplicate:true,duplicateReason:'Distinct meter ABC-003, same measured usage'}});
 assert.equal(r.status,200);
});
test('workflow order, version checks and entry-user review restrictions are enforced',async()=>{
 let a=await create();
 assert.equal((await request(`/api/v1/activity-data/${a.id}/calculate`,{actor:'reviewer',method:'POST',body:{version:a.version}})).status,409);
 assert.equal((await request(`/api/v1/activity-data/${a.id}`,{method:'PATCH',body:{quantity:50,version:999}})).status,409);
 a=await step(a,'submit','entry');
 assert.equal((await request(`/api/v1/activity-data/${a.id}/start-review`,{actor:'entry',method:'POST',body:{version:a.version}})).status,403);
 assert.equal((await request(`/api/v1/activity-data/${a.id}/verify`,{actor:'reviewer',method:'POST',body:{version:a.version}})).status,409);
});
test('complete maker-checker flow calculates once and updates dashboard exactly',async()=>{
 const start=(await request('/api/v1/dashboard')).data.totalKgCO2e;
 let a=await create({quantity:1001});a=await step(a,'submit','entry');a=await step(a,'start-review');a=await step(a,'verify');
 assert.equal(a.status,'VERIFIED');assert.equal((await request('/api/v1/dashboard')).data.totalKgCO2e,start);
 a=await step(a,'calculate');assert.equal(a.calculation.kgCO2e,710.71);assert.equal(a.calculation.version,'DEMO-v1');
 assert.ok(Math.abs((await request('/api/v1/dashboard')).data.totalKgCO2e-start-710.71)<0.000001);
 await step(a,'calculate');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM calculations WHERE activity_id=?').get(a.id).n,1);
 assert.ok(Math.abs((await request('/api/v1/dashboard')).data.totalKgCO2e-start-710.71)<0.000001);
 assert.equal((await request(`/api/v1/activity-data/${a.id}`,{method:'PATCH',body:{version:a.version,quantity:333}})).status,409);
 assert.equal((await request(`/api/v1/activity-data/${a.id}`,{method:'DELETE',body:{version:a.version}})).status,409);
});
test('administrators cannot approve their own entry',async()=>{
 let a=await create({},'admin');a=await step(a,'submit','admin');a=await step(a,'start-review','admin');
 const r=await request(`/api/v1/activity-data/${a.id}/verify`,{actor:'admin',method:'POST',body:{version:a.version}});assert.equal(r.status,403);assert.equal(r.body.error.code,'SELF_APPROVAL_BLOCKED');
});
test('rejection requires reason and correction returns a record to draft',async()=>{
 let a=await create();a=await step(a,'submit','entry');
 assert.equal((await request(`/api/v1/activity-data/${a.id}/reject`,{actor:'reviewer',method:'POST',body:{version:a.version,reason:'no'}})).status,422);
 a=await step(a,'reject','reviewer',{reason:'Please check the meter reading against the original record.'});assert.equal(a.status,'REJECTED');
 const r=await request(`/api/v1/activity-data/${a.id}`,{method:'PATCH',body:{version:a.version,description:'Corrected meter record'}});assert.equal(r.status,200);assert.equal(r.data.status,'DRAFT');assert.equal(r.data.rejectionReason,null);
});
test('locked reporting period blocks activity writes until admin unlocks it',async()=>{
 const pid=meta.reportingPeriods[0].id;
 try {
  assert.equal((await request(`/api/v1/reporting-periods/${pid}/lock`,{actor:'entry',method:'POST',body:{}})).status,403);
  assert.equal((await request(`/api/v1/reporting-periods/${pid}/lock`,{actor:'admin',method:'POST',body:{}})).status,200);
  const r=await request('/api/v1/activity-data',{method:'POST',body:activity()});assert.equal(r.status,409);assert.equal(r.body.error.code,'PERIOD_LOCKED');
 }finally{assert.equal((await request(`/api/v1/reporting-periods/${pid}/unlock`,{actor:'admin',method:'POST',body:{}})).status,200);}
});
test('cross-tenant activity reads and mutations do not reveal records',async()=>{
 const a=await create();
 for(const method of ['GET','PATCH','DELETE']){const r=await request(`/api/v1/activity-data/${a.id}`,{actor:'isolation',method,...(method==='GET'?{}:{body:{version:a.version,quantity:42}})});assert.equal(r.status,404);}
});
let uploaded;
test('multipart PDF upload extracts actual quantity separately from money',async()=>{
 const r=await request('/api/v1/documents/upload',{method:'POST',form:fileForm()});assert.equal(r.status,201,JSON.stringify(r.body));uploaded=r.data;
 assert.equal(uploaded.extraction.fields.quantity,12500);assert.equal(uploaded.extraction.fields.amountInr,112500);assert.equal(uploaded.status,'REVIEW_REQUIRED');assert.equal(uploaded.extraction.ocrAvailable,false);
 const duplicate=await request('/api/v1/documents/upload',{method:'POST',form:fileForm()});assert.equal(duplicate.status,409);assert.equal(duplicate.body.error.details.documentId,uploaded.id);
});
test('invoice download preserves bytes and checks authentication and tenant',async()=>{
 const r=await fetch(base+`/api/v1/documents/${uploaded.id}/download`,{headers:{Authorization:'Bearer '+tokens.ceo}});assert.equal(r.status,200);assert.equal(sha256(Buffer.from(await r.arrayBuffer())),uploaded.sha256);
 assert.equal((await request(`/api/v1/documents/${uploaded.id}/download`,{actor:null})).status,401);
 assert.equal((await request(`/api/v1/documents/${uploaded.id}/download`,{actor:'isolation'})).status,404);
 assert.equal((await request(`/api/v1/documents/${uploaded.id}`,{actor:'isolation'})).status,404);
});
test('invoice confirmation requires human review and consumption, not totalAmount',async()=>{
 const common={...activity({quantity:12500,activityDate:'2026-09-30'}),version:uploaded.version,vendor:'Greenfield Utilities (Demo)',invoiceNumber:'DEMO-ELEC-2026-0930',amountInr:112500};
 assert.equal((await request(`/api/v1/documents/${uploaded.id}/create-activity`,{method:'POST',body:common})).status,422);
 const {quantity,...moneyOnly}=common;
 assert.equal((await request(`/api/v1/documents/${uploaded.id}/create-activity`,{method:'POST',body:{...moneyOnly,reviewConfirmed:true,totalAmount:112500}})).status,422);
 const r=await request(`/api/v1/documents/${uploaded.id}/create-activity`,{method:'POST',body:{...common,reviewConfirmed:true}});
 assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.data.quantity,12500);assert.equal(r.data.scope,'SCOPE_2');assert.equal(r.data.amountInr,112500);assert.equal(r.data.status,'DRAFT');assert.equal(r.data.inputSource,'INVOICE');assert.equal(r.data.documentId,uploaded.id);
 const doc=(await request(`/api/v1/documents/${uploaded.id}`)).data;assert.equal(doc.status,'LINKED');
 assert.equal((await request(`/api/v1/documents/${uploaded.id}/create-activity`,{method:'POST',body:{...common,version:doc.version,reviewConfirmed:true}})).status,409);
});
test('different files with the same vendor and invoice number cannot double count',async()=>{
 const r=await request('/api/v1/documents/upload',{method:'POST',form:fileForm('sample-electricity.txt',null,'text/plain')});assert.equal(r.status,201);
 const before=db.prepare('SELECT COUNT(*) AS n FROM activities').get().n;
 const body={...activity({quantity:9876}),version:r.data.version,vendor:'greenfield utilities (demo)',invoiceNumber:'demo-elec-2026-0930',amountInr:112500,reviewConfirmed:true};
 const result=await request(`/api/v1/documents/${r.data.id}/create-activity`,{method:'POST',body});assert.equal(result.status,409);assert.equal(result.body.error.code,'DUPLICATE_INVOICE');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,before);
 assert.equal((await request(`/api/v1/documents/${r.data.id}`)).data.status,'REVIEW_REQUIRED');
});
test('scanned invoice supports explicit manual fields without fake OCR',async()=>{
 const r=await request('/api/v1/documents/upload',{method:'POST',form:fileForm('scanned-electricity.png',null,'image/png')});assert.equal(r.status,201);assert.equal(r.data.extraction.method,'MANUAL_REVIEW');assert.deepEqual(r.data.extraction.fields,{});
 const body={...activity({quantity:9800,activityDate:'2026-10-01'}),version:r.data.version,vendor:'Campus Energy Services (Demo)',invoiceNumber:'DEMO-SCAN-2026-1001',amountInr:88200,reviewConfirmed:true};
 const result=await request(`/api/v1/documents/${r.data.id}/create-activity`,{method:'POST',body});assert.equal(result.status,201);assert.equal(result.data.quantity,9800);
});
test('uploads reject invalid signatures, multiple files and read-only actors',async()=>{
 assert.equal((await request('/api/v1/documents/upload',{method:'POST',form:fileForm('bad.pdf',Buffer.from('not a pdf'))})).status,415);
 const form=fileForm();form.append('extra',new Blob(['bad'],{type:'text/plain'}),'extra.txt');assert.equal((await request('/api/v1/documents/upload',{method:'POST',form})).status,422);
 assert.equal((await request('/api/v1/documents/upload',{actor:'ceo',method:'POST',form:fileForm()})).status,403);
});
test('invoice-linked calculation updates evidence coverage using consumption',async()=>{
 const doc=(await request('/api/v1/documents/'+uploaded.id)).data;
 let a=(await request('/api/v1/activity-data/'+doc.activityId)).data;
 const start=(await request('/api/v1/dashboard')).data;
 a=await step(a,'submit','entry');a=await step(a,'start-review');a=await step(a,'verify');a=await step(a,'calculate');
 assert.equal(a.calculation.kgCO2e,8875);const end=(await request('/api/v1/dashboard')).data;
 assert.equal(end.evidenceCount,start.evidenceCount+1);assert.ok(Math.abs(end.totalKgCO2e-start.totalKgCO2e-8875)<0.000001);
});
test('audit records cannot be edited or deleted and are scoped to the caller',async()=>{
 assert.throws(()=>db.prepare("UPDATE audit_logs SET action='ALTERED'").run(),/cannot be changed/);
 assert.throws(()=>db.prepare('DELETE FROM audit_logs').run(),/cannot be deleted/);
 const log=await request('/api/v1/audit-logs?limit=100',{actor:'ceo'});assert.equal(log.status,200);assert.ok(log.data.items.some(x=>x.action==='ACTIVITY_CALCULATED'));
 assert.equal((await request('/api/v1/audit-logs?universityId='+OTHER)).status,403);
 const other=(await request('/api/v1/audit-logs',{actor:'isolation'})).data;assert.ok(other.items.every(x=>x.action==='LOGIN'));
});
test('report totals reconcile with calculation rows and factor snapshots',async()=>{
 const r=await request('/api/v1/reports/summary',{actor:'ceo'});assert.equal(r.status,200);assert.equal(r.data.demoOnly,true);
 const sum=db.prepare('SELECT SUM(kg_co2e) AS n FROM calculations WHERE university_id=?').get(meta.university.id).n;
 assert.ok(Math.abs(r.data.summary.totalKgCO2e-sum)<0.000001);
 const csv=await request('/api/v1/reports/export?format=csv',{actor:'ceo'});assert.equal(csv.status,200);assert.match(csv.body,/DEMO ONLY/);assert.match(csv.body,/DEMO-v1/);assert.match(csv.body,/not consumption/);
});
test('pagination, review queue and malformed JSON return stable API errors',async()=>{
 assert.equal((await request('/api/v1/activity-data?limit=1000')).status,422);
 const page=await request('/api/v1/activity-data?limit=2&page=2');assert.equal(page.data.items.length,2);assert.equal(page.data.pagination.page,2);
 const queue=await request('/api/v1/activity-data?status=REVIEW_QUEUE');assert.ok(queue.data.items.every(a=>['SUBMITTED','UNDER_REVIEW','VERIFIED'].includes(a.status)));
 const response=await fetch(base+'/api/v1/activity-data',{method:'POST',headers:{Authorization:'Bearer '+tokens.entry,'Content-Type':'application/json'},body:'{broken'});assert.equal(response.status,400);assert.equal((await response.json()).error.code,'INVALID_JSON');
});
test('cross-origin requests are blocked',async()=>{
 const r=await request('/api/v1/meta',{headers:{Origin:'https://untrusted.example'}});assert.equal(r.status,403);assert.equal(r.body.error.code,'INVALID_ORIGIN');
});
test('draft deletion preserves the audit record',async()=>{
 const a=await create();assert.equal((await request('/api/v1/activity-data/'+a.id,{method:'DELETE',body:{version:a.version}})).status,200);
 assert.equal((await request('/api/v1/activity-data/'+a.id)).status,404);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id=? AND action='ACTIVITY_DELETED'").get(a.id).n,1);
});
test('file-backed SQLite data persists through closing and reopening',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'carbonsynq-persistence-'));const filename=path.join(dir,'demo.sqlite');
 try{const first=openDatabase(filename);first.prepare('INSERT INTO universities VALUES (?,?,?,?,?)').run('persistence','Persistent campus','PERSIST','Test','2026-10-02T00:00:00Z');first.close();
 const second=openDatabase(filename);assert.equal(second.prepare('SELECT name FROM universities WHERE id=?').get('persistence').name,'Persistent campus');second.close();}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('logout revokes a session rather than just hiding the UI',async()=>{
 const login=await request('/api/v1/auth/login',{actor:null,method:'POST',body:{email:'ceo@carbonsynq.demo',password:'Demo@12345'}});
 const token=login.data.token;
 assert.equal((await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}})).status,200);
 assert.equal((await fetch(base+'/api/v1/auth/me',{headers:{Authorization:'Bearer '+token}})).status,401);
});
