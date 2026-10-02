import { id, uuid, fail, hash, role, version } from '../core.mjs';
import { fields, text, reason, scaled, format as decimalFormat } from '../university/core.mjs';
import { tenantTx, audit, guardClient } from '../db.mjs';
import { ownedJob, done } from '../jobs.mjs';
import { safeCsvCell } from '../ingestion/normalize.mjs';
export const EXPORT_COLUMNS=['ledger','record_id','activity_date','campus_id','category','scope','scope3_category','quantity','unit','kg_co2e','scope1_kg','scope2_location_kg','scope2_market_kg','biogenic_co2_kg','evidence_count','data_quality','provenance'];
export async function requestExport(s,b) {
 role(s.user,['ADMIN']);fields(b,['periodId','title','format']);if(!['csv','jsonl'].includes(b.format))fail(422,'INVALID_FORMAT','Choose csv or jsonl.');const p=await s.period(uuid(b.periodId),false);
 if(p.status!=='LOCKED')fail(409,'PERIOD_MUST_BE_LOCKED','Lock the reporting period before scheduling a point-in-time inventory export.');
 await s.lockKey('export-requests');
 if(await s.count('u_o_exports',{status:['QUEUED','PROCESSING']})>=3)fail(429,'EXPORT_QUEUE_LIMIT','At most three inventory exports may be pending per university.');
 if(await s.count('u_o_exports',{})>=100)fail(422,'EXPORT_RETENTION_LIMIT','This release permits 100 retained exports per university. Archive using the reviewed retention process before expanding this bound.');
 const r=await s.insert('u_o_exports',{period_id:p.id,period_version:p.version,title:text(b.title,'title',180),format:b.format,status:'QUEUED',created_by:s.user.id});await s.enqueue('BUILD_EXPORT',r.id);await s.audit('O_EXPORT_REQUESTED',r.id,{periodVersion:p.version});return r;
}
export async function reviewExport(s,rid,b) {
 role(s.user,['ADMIN','REVIEWER']);fields(b,['version','decision','reason']);const r=await s.get('u_o_exports',uuid(rid),{lock:true});version(r,b.version);if(r.created_by===s.user.id)fail(403,'SELF_APPROVAL','Another reviewer must approve or reject this export.');
 if(r.status!=='READY')fail(409,'NOT_READY','Only a completed export can be reviewed.');const why=reason(b.reason);if(!['APPROVE','REJECT'].includes(b.decision))fail(422,'INVALID_DECISION','Use APPROVE or REJECT.');
 const p=await s.period(r.period_id,false);if(p.status!=='LOCKED'||p.version!==r.period_version)fail(409,'STALE_REPORT','The reporting period changed. Generate a new export.');
 const out=await s.update('u_o_exports',r.id,{status:b.decision==='APPROVE'?'APPROVED':'REJECTED',approved_by:b.decision==='APPROVE'?s.user.id:null,approval_reason:why});await s.audit('O_EXPORT_'+out.status,r.id,{reason:why,sha256:r.sha256});return publicExport(out);
}
export function publicExport(r){const {object_key,object_version,...safe}=r;return safe;}
export function mapExportRow(row) {
 const mapped={...row,scope1_kg:row.scope1_kg??null,scope2_location_kg:row.location_kg??null,scope2_market_kg:row.market_kg??null,biogenic_co2_kg:row.biogenic_kg??null};
 return Object.fromEntries(EXPORT_COLUMNS.map(k=>[k,mapped[k]??null]));
}
/** Bounded page-by-page serialization. Exact sums; Scope 2 alternatives are not added together. */
export async function encodeInventory(pages, format, { maxRows=100000, maxBytes=32*1024*1024 }={}) {
 if(!['csv','jsonl'].includes(format))throw Error('Invalid internal export format.');
 const parts=[];let bytes=0,count=0;const scopes={SCOPE_1:0n,SCOPE_2:0n,SCOPE_3:0n,SUPPLEMENTAL:0n};let market=0n,biogenic=0n,missingMarket=0;
 const append=s=>{const b=Buffer.from(s);bytes+=b.length;if(bytes>maxBytes)fail(422,'EXPORT_BYTE_LIMIT','Export exceeds 32 MiB. Split reporting periods or request a reviewed external export.');parts.push(b);};
 if(format==='csv')append(EXPORT_COLUMNS.map(safeCsvCell).join(',')+'\r\n');
 for await(const page of pages)for(const input of page){if(++count>maxRows)fail(422,'EXPORT_ROW_LIMIT','Export exceeds 100,000 rows. Split reporting periods.');const r=mapExportRow(input);
  if(!(r.scope in scopes))fail(422,'UNKNOWN_SCOPE','An inventory row has an unsupported scope.');scopes[r.scope]+=scaled(r.kg_co2e);
  if(r.scope==='SCOPE_2'){if(r.scope2_market_kg===null)missingMarket++;else market+=scaled(r.scope2_market_kg);}
  if(r.biogenic_co2_kg!==null)biogenic+=scaled(r.biogenic_co2_kg);
  if(format==='jsonl')append(JSON.stringify(r)+'\n');else append(EXPORT_COLUMNS.map(k=>safeCsvCell(typeof r[k]==='object'&&r[k]!==null?JSON.stringify(r[k]):r[k]??'')).join(',')+'\r\n');
 }
 const totals={scopes:Object.fromEntries(Object.entries(scopes).map(([k,v])=>[k,decimalFormat(v)])),primaryKgCo2e:decimalFormat(scopes.SCOPE_1+scopes.SCOPE_2+scopes.SCOPE_3),scope2MarketKgCo2e:missingMarket?null:decimalFormat(market),scope2RowsWithoutMarketResult:missingMarket,biogenicCo2Kg:decimalFormat(biogenic),accountingNote:'Primary total uses location-based Scope 2. Market-based results are alternatives. Supplemental travel and biogenic CO2 are separate. This is an internally reviewed inventory export, not a full regulatory report.'};
 const result=Buffer.concat(parts);return {bytes:result,sha256:hash(result),rowCount:count,totals};
}
export async function processExport(pool,storage,job,cfg) {
 const request=await tenantTx(pool,job.tenant_id,async c=>{await ownedJob(c,job);const tenant=(await c.query('SELECT status FROM cs.tenants WHERE id=$1',[job.tenant_id])).rows[0];if(tenant?.status!=='ACTIVE')fail(409,'TENANT_SUSPENDED','University is suspended.');const r=(await c.query('SELECT * FROM cs.u_o_exports WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[job.tenant_id,job.entity_id])).rows[0];if(!r)fail(404,'NOT_FOUND','Export not found.');if(['READY','APPROVED','REJECTED'].includes(r.status)){await done(c,job);return null;}await c.query("UPDATE cs.u_o_exports SET status='PROCESSING',error_code=NULL,version=version+1 WHERE tenant_id=$1 AND id=$2",[job.tenant_id,r.id]);return r;});
 if(!request)return;
  const c=guardClient(await pool.connect());let encoded,broken=false;
 try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await c.query("SELECT set_config('app.tenant_id',$1,true)",[job.tenant_id]);await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='30s'");await c.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
  const period=(await c.query('SELECT status,version FROM cs.periods WHERE tenant_id=$1 AND id=$2 FOR SHARE',[job.tenant_id,request.period_id])).rows[0];
  if(period?.status!=='LOCKED'||period.version!==request.period_version)fail(409,'STALE_REPORT','Reporting period changed before export.');
  const started=Date.now();
  async function* pages(){let after=null,afterLedger=null;for(;;){if(Date.now()-started>90000)fail(503,'EXPORT_TIMEOUT','Export exceeded its time budget.');
   const rows=(await c.query(`SELECT i.*,a.scope1_kg,a.location_kg,a.market_kg,a.biogenic_kg FROM cs.u_inventory i LEFT JOIN cs.u_c_active a ON i.ledger='CARBON_SCOPE12' AND a.tenant_id=i.tenant_id AND a.record_id=i.record_id WHERE i.tenant_id=$1 AND i.period_id=$2 AND ($3::uuid IS NULL OR (i.id,i.ledger)>($3::uuid,$4::text)) ORDER BY i.id,i.ledger LIMIT 500`,[job.tenant_id,request.period_id,after,afterLedger])).rows;
   if(!rows.length)break;yield rows;after=rows.at(-1).id;afterLedger=rows.at(-1).ledger;if(rows.length<500)break;
  }}
  encoded=await encodeInventory(pages(),request.format,{maxRows:cfg.exportMaxRows,maxBytes:cfg.exportMaxBytes});await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{broken=true;});throw e;}finally{c.release(broken);}
 // Attempt-specific key: a stale worker cannot overwrite the acknowledged artifact.
 const key=`${job.tenant_id}/exports/${request.id}/${job.lease_token}.${request.format}`;
 const stored=await storage.put(key,encoded.bytes,request.format==='csv'?'text/csv':'application/x-ndjson');
 await tenantTx(pool,job.tenant_id,async c=>{
  await ownedJob(c,job);const tenant=(await c.query('SELECT status FROM cs.tenants WHERE id=$1 FOR SHARE',[job.tenant_id])).rows[0];if(tenant?.status!=='ACTIVE')fail(409,'TENANT_SUSPENDED','University is suspended.');const p=(await c.query('SELECT status,version FROM cs.periods WHERE tenant_id=$1 AND id=$2 FOR SHARE',[job.tenant_id,request.period_id])).rows[0];
  if(p.status!=='LOCKED'||p.version!==request.period_version)fail(409,'STALE_REPORT','Period changed during export generation.');
  await c.query("UPDATE cs.u_o_exports SET status='READY',row_count=$3,byte_count=$4,sha256=$5,object_key=$6,object_version=$7,totals=$8,version=version+1 WHERE tenant_id=$1 AND id=$2",[job.tenant_id,request.id,encoded.rowCount,encoded.bytes.length,encoded.sha256,key,stored.versionId,JSON.stringify(encoded.totals)]);
  await audit(c,{tenant_id:job.tenant_id},'O_EXPORT_READY',request.id,{rows:encoded.rowCount,sha256:encoded.sha256});await done(c,job);
 });
}
export async function downloadExport(s,storage,rid,{preview=false}={}) {
 role(s.user,['ADMIN','REVIEWER','LEADERSHIP']);const r=await s.get('u_o_exports',uuid(rid));
 if(preview){role(s.user,['ADMIN','REVIEWER']);if(!['READY','APPROVED'].includes(r.status))fail(409,'NOT_READY','The export is not ready for review.');}
 else if(r.status!=='APPROVED')fail(409,'APPROVAL_REQUIRED','An independent reviewer must approve this export before publication.');
 if(!r.object_version||!r.sha256)fail(409,'NOT_READY','Export bytes are not available.');
 const bytes=await storage.get(r.object_key,r.object_version,32*1024*1024);if(bytes.length!==Number(r.byte_count)||hash(bytes)!==r.sha256)fail(503,'EXPORT_INTEGRITY','Export bytes do not match the recorded hash.');
 await s.audit(preview?'O_EXPORT_REVIEW_DOWNLOAD':'O_EXPORT_DOWNLOADED',r.id,{sha256:r.sha256});
 return {name:`CarbonSynq-Inventory-${preview?'REVIEW-':''}${r.id}.${r.format}`,mime:r.format==='csv'?'text/csv; charset=utf-8':'application/x-ndjson',bytes};
}
