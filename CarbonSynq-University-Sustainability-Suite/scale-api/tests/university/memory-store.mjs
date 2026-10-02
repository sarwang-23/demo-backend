/** Test double only. This exercises domain behavior, NOT PostgreSQL, RLS, locks or migrations. */
import { id, fail } from '../../src/core.mjs';
import { UniversityStore, TABLES } from '../../src/university/store.mjs';
import { inventorySummary } from '../../src/university/reporting.mjs';
import { sum } from '../../src/university/core.mjs';
const copy=x=>structuredClone(x);
export class MemoryStore {
  constructor(state,user){this.state=state;this.user=user;this.tenant=user.tenant_id;}
  for(user){return new MemoryStore(this.state,user);}
  async lockKey(key){this.state.locks.push(key);}
  async maybe(table,rid){const r=this.state.tables[table]?.find(r=>r.id===rid&&(table==='tenants'?r.id===this.tenant:r.tenant_id===this.tenant));return r?copy(r):null;}
  async get(table,rid){const r=await this.maybe(table,rid);if(!r)fail(404,'NOT_FOUND','Record not found.');return r;}
  async rows(table,filters={},limit=1000){const rows=(this.state.tables[table]||[]).filter(r=>r.tenant_id===this.tenant&&Object.entries(filters).every(([k,v])=>Array.isArray(v)?v.includes(r[k]):r[k]===v));if(rows.length>limit)fail(422,'RESULT_LIMIT','Test fixture result cap');return copy(rows);}
  async count(table,filters={}){return (await this.rows(table,filters,10000)).length;}
  async listPage(table,filters={},q={}){const items=await this.rows(table,filters,10000);return {items:items.slice(0,Number(q.limit||50)),nextCursor:null};}
  async insert(table,data){const defaults={u_tasks:'OPEN',u_submissions:'DRAFT',u_factors:'DRAFT',u_emissions:'DRAFT',u_voids:'SUBMITTED',u_supplier_requests:'DRAFT',u_materiality:'OPEN',u_reports:'SUBMITTED',u_pcf_studies:'DRAFT',u_initiatives:'PLANNED'};
    const r={id:id(),tenant_id:this.tenant,created_at:new Date().toISOString(),...(TABLES[table]?.includes('version')?{version:1}:{}),...(defaults[table]?{status:defaults[table]}:{}),...copy(data)};
    if(r.tenant_id!==this.tenant)fail(403,'FORBIDDEN','Tenant mismatch');if(table==='u_invites')Object.assign(r,{revoked:false,consumed:false,...r});
    if(table==='u_tasks')r.waiver_reason??=null;if(table==='u_submissions'){r.approved_by??=null;r.rejection_reason??=null;}
    if(table==='u_supplier_requests'){r.answers??=null;r.evidence_ids??=[];}
    const rows=this.state.tables[table]||=[];
    if(table==='u_emissions'&&rows.some(x=>x.tenant_id===this.tenant&&x.external_key===r.external_key))fail(409,'CONFLICT','Duplicate source key');
    rows.push(r);return copy(r);}
  async update(table,rid,data){const rows=this.state.tables[table]||[],i=rows.findIndex(r=>r.tenant_id===this.tenant&&r.id===rid);if(i<0)fail(404,'NOT_FOUND','Record not found.');const old=rows[i];rows[i]={...old,...copy(data),...(old.version?{version:old.version+1}:{})};return copy(rows[i]);}
  async period(rid,write=true){const p=await this.get('periods',rid);if(write&&p.status!=='OPEN')fail(409,'PERIOD_LOCKED','Reporting period is locked.');return p;}
  async userRef(...args){return UniversityStore.prototype.userRef.apply(this,args);}
  async location(...args){return UniversityStore.prototype.location.apply(this,args);}
  async evidence(...args){return UniversityStore.prototype.evidence.apply(this,args);}
  async audit(action,rid,details={}){this.state.audit.push({action,rid,userId:this.user.id,details:copy(details)});}
  async inventory(pid){const rows=copy(this.state.coreInventory.filter(r=>r.tenant_id===this.tenant&&r.period_id===pid));for(const e of await this.rows('u_emissions',{period_id:pid,status:'CALCULATED'},10000)){if(await this.count('u_voids',{emission_id:e.id,status:'APPROVED'}))continue;const c=(await this.rows('u_calculations',{emission_id:e.id},1))[0];if(c)rows.push({...c,record_id:e.id,period_id:pid,campus_id:e.campus_id,activity_date:e.activity_date,category:e.category,scope:e.scope,scope3_category:e.scope3_category,quantity:e.quantity,unit:e.unit,data_quality:e.data_quality,ledger:'UNIVERSITY',evidence_count:e.evidence_ids.length});}return rows;}
  async inventoryTotals(pid){return (await this.inventory(pid)).map(r=>({...r,records:1,evidence_records:r.evidence_count>0?1:0}));}
  async metricRows(pid){const all=await this.rows('u_metric_snapshots',{period_id:pid},10000);return all.filter(r=>!all.some(n=>n.task_id===r.task_id&&n.revision>r.revision));}
  async missingTasks(pid){const tasks=await this.rows('u_tasks',{period_id:pid,status:'OPEN'},10000);return tasks.map(t=>({...t,overdue:t.due_date<new Date().toISOString().slice(0,10)}));}
  async transaction(fn){const snap=copy(this.state);try{return await fn(this);}catch(e){Object.assign(this.state,snap);throw e;}}
}
export function fixture(){const tenant=id(),campus=id(),period=id(),state={tables:{},audit:[],locks:[],coreInventory:[]},actors={};
  state.tables.tenants=[{id:tenant,name:'Synthetic Test University',status:'ACTIVE'}];state.tables.campuses=[{id:campus,tenant_id:tenant,name:'Synthetic campus',code:'TEST',created_at:new Date().toISOString()}];state.tables.periods=[{id:period,tenant_id:tenant,name:'Synthetic FY',start_date:'2026-04-01',end_date:'2027-03-31',status:'OPEN',version:1,created_at:new Date().toISOString()}];state.tables.users=[];
  for(const name of ['ADMIN','ENTRY','REVIEWER','LEADERSHIP','OTHER_ENTRY']){const a={id:id(),tenant_id:tenant,role:name==='OTHER_ENTRY'?'ENTRY':name,name,email:name.toLowerCase()+'@test.invalid',active:true};actors[name]=a;state.tables.users.push(a);}
  const document={id:id(),tenant_id:tenant,original_name:'synthetic-evidence.txt',mime_type:'text/plain',file_size:'100',sha256:'a'.repeat(64),object_version:'test-version-only',status:'REVIEW_REQUIRED',scan_result:'CLEAN',scan_engine:'CONTROLLED_TEST_DOUBLE',uploaded_by:actors.ENTRY.id};state.tables.documents=[document];const s=new MemoryStore(state,actors.ADMIN);
  return {s,state,actors,tenant,campus,period,document};}
export const factorBody={category:'PURCHASED_GOODS',unit:'kg',value:'1.5',method:'ACTIVITY_BASED',source:'SYNTHETIC TEST FACTOR - never use for real reporting',sourceUrl:'https://example.invalid/test-factor',region:'TEST',boundary:'Synthetic cradle-to-gate test-only boundary',versionLabel:'TEST-v1',validFrom:'2026-04-01',validTo:'2027-03-31'};
export function emissionBody(f,factorId,extra={}){return {periodId:f.period,campusId:f.campus,category:'PURCHASED_GOODS',unit:'kg',quantity:'100',activityDate:'2026-06-01',externalKey:'test:'+id(),description:'Synthetic purchased goods quantity',factorId,dataQuality:'MEASURED',evidenceIds:[f.document.id],...extra};}
