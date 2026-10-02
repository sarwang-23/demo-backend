/** SQL boundary for the university extension. Identifiers below are compile-time allowlists.
 * No caller-controlled SQL, dynamic table names, or tenant switching is accepted.
 */
import { id, uuid, fail, pagination, page } from '../core.mjs';
import { audit, guardClient } from '../db.mjs';
import { INGESTION_TABLES, INGESTION_JSON } from '../ingestion/schema.mjs';
import { OPS_TABLES, OPS_JSON } from '../operations/schema.mjs';
import { assertEvidenceAccess } from '../operations/access.mjs';
import { CARBON_TABLES,CARBON_JSON } from './carbon/schema.mjs';
export const TABLES=Object.freeze({
  ...CARBON_TABLES, ...INGESTION_TABLES, ...OPS_TABLES,
  tenants:'id name status storage_quota_bytes storage_used_bytes created_at',
  users:'id tenant_id name email role active created_at',
  campuses:'id tenant_id name code created_at',buildings:'id tenant_id campus_id name created_at',
  periods:'id tenant_id name start_date end_date status version created_at',
  documents:'id tenant_id original_name mime_type file_size sha256 object_version status scan_result scan_engine uploaded_by extraction version created_at',
  activities:'id tenant_id period_id campus_id scope status created_by created_at',
  u_departments:'id tenant_id campus_id name code owner_id version created_at',
  u_kpis:'id tenant_id code name domain unit aggregation evidence_required max_value guidance created_by version created_at',
  u_tasks:'id tenant_id period_id campus_id department_id kpi_id assignee_id reviewer_id bucket interval_start interval_end due_date status waiver_reason created_by version created_at',
  u_submissions:'id tenant_id task_id revision value unit notes evidence_ids status created_by approved_by rejection_reason correction_reason version created_at',
  u_metric_snapshots:'id tenant_id submission_id task_id revision period_id campus_id kpi_id bucket interval_start interval_end value unit aggregation kpi_code evidence approved_by created_at',
  u_factors:'id tenant_id category unit value method source source_url region boundary version_label valid_from valid_to currency price_year status created_by approved_by version created_at',
  u_emissions:'id tenant_id period_id campus_id department_id category scope scope3_category quantity unit activity_date external_key description factor_id data_quality assumptions currency price_year evidence_ids replaces_id status created_by approved_by rejection_reason version created_at',
  u_calculations:'id tenant_id emission_id factor_id quantity factor_value kg_co2e provenance created_at',
  u_voids:'id tenant_id emission_id reason status created_by approved_by version created_at',
  u_scope3_screenings:'id tenant_id period_id category_number decision rationale created_by version created_at',
  u_suppliers:'id tenant_id name code contact_email category created_by version created_at',
  u_supplier_requests:'id tenant_id supplier_id period_id title questions answers evidence_ids due_date status created_by approved_by rejection_reason version created_at',
  u_materiality:'id tenant_id period_id title topics impact_threshold financial_threshold min_responses status snapshot created_by approved_by version created_at',
  u_invites:'id tenant_id kind target_id token_hash stakeholder_group expires_at revoked consumed created_by created_at',
  u_responses:'id tenant_id assessment_id invite_id stakeholder_group scores created_at',
  u_reports:'id tenant_id period_id title purpose period_version snapshot snapshot_hash status created_by approved_by rejection_reason version created_at',
  u_targets:'id tenant_id name baseline_report_id scope2_basis scopes baseline_kg reduction_percent target_date owner_id created_by version created_at',
  u_initiatives:'id tenant_id target_id campus_id name owner_id start_date end_date estimated_reduction_kg investment_inr annual_savings_inr assumptions status progress created_by version created_at',
  u_pcf_studies:'id tenant_id name functional_unit output_quantity boundary study_date bom result status created_by approved_by rejection_reason version created_at'
});
const jsonColumns=new Set([...CARBON_JSON,...INGESTION_JSON,...OPS_JSON,'evidence_ids','evidence','provenance','questions','answers','topics','scores','snapshot','scopes','bom','result']);
function columns(table){const cols=TABLES[table];if(!cols)throw Error('Internal table allowlist violation');return cols.split(' ');}
function checkKeys(table,keys){const allowed=columns(table);if(keys.some(k=>!allowed.includes(k)))throw Error('Internal column allowlist violation: '+table);}
function value(key,x){return jsonColumns.has(key)&&x!==null?JSON.stringify(x):x;}
function filtersSql(table,filters,params){checkKeys(table,Object.keys(filters));let sql='';for(const [key,v] of Object.entries(filters)){if(key==='tenant_id')throw Error('Tenant filter is server-owned');if(v===null){sql+=` AND ${key} IS NULL`;continue;}
  if(Array.isArray(v)){params.push(v);sql+=` AND ${key}=ANY($${params.length})`;}
  else{params.push(v);sql+=` AND ${key}=$${params.length}`;}}return sql;}
export class UniversityStore {
  constructor(client,user){this.client=client;this.user=user;this.tenant=user.tenant_id;}
  async lockKey(key){await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[this.tenant+":university:"+key]);}
  async maybe(table,rid,{lock=false,share=false}={}) {uuid(rid);const cols=columns(table);const tenantField=table==='tenants'?'id':'tenant_id';
    const record=(await this.client.query(`SELECT ${cols.join(',')} FROM cs.${table} WHERE ${tenantField}=$1 AND id=$2${lock?' FOR UPDATE':share?' FOR SHARE':''}`,[this.tenant,rid])).rows[0]||null;
    if(table==='documents'&&record)await assertEvidenceAccess(this.client,this.user,record);return record;}
  async get(table,rid,options={}){const r=await this.maybe(table,rid,options);if(!r)fail(404,'NOT_FOUND','Record not found.');return r;}
  async rows(table,filters={},limit=1000){columns(table);const p=[this.tenant];const extra=filtersSql(table,filters,p);p.push(limit+1);
    const rows=(await this.client.query(`SELECT ${columns(table).join(',')} FROM cs.${table} WHERE tenant_id=$1${extra} ORDER BY created_at,id LIMIT $${p.length}`,p)).rows;
    if(rows.length>limit)fail(422,'RESULT_LIMIT','This operation exceeds the bounded result size. Use paginated listing or split the reporting boundary.');return rows;}
  async listPage(table,filters={},query={}){const {limit,cursor}=pagination(query),p=[this.tenant];let extra=filtersSql(table,filters,p);
    if(cursor){p.push(cursor[0],cursor[1]);extra+=` AND (created_at,id)<($${p.length-1}::timestamptz,$${p.length}::uuid)`;}p.push(limit+1);
    return page((await this.client.query(`SELECT ${columns(table).join(',')} FROM cs.${table} WHERE tenant_id=$1${extra} ORDER BY created_at DESC,id DESC LIMIT $${p.length}`,p)).rows,limit);}
  async count(table,filters={}){columns(table);const p=[this.tenant],extra=filtersSql(table,filters,p);return Number((await this.client.query(`SELECT count(*)::text AS n FROM cs.${table} WHERE tenant_id=$1${extra}`,p)).rows[0].n);}
  async insert(table,data){if(!table.startsWith('u_'))throw Error('University extension may only insert its own tables');checkKeys(table,Object.keys(data));
    const row={id:id(),tenant_id:this.tenant,...data};if(row.tenant_id!==this.tenant)throw Error('Tenant invariant');const keys=Object.keys(row);
    return (await this.client.query(`INSERT INTO cs.${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING ${columns(table).join(',')}`,keys.map(k=>value(k,row[k])))).rows[0];}
  async update(table,rid,data){if(!table.startsWith('u_'))throw Error('University extension may only update its own tables');const keys=Object.keys(data);checkKeys(table,keys);
    if(keys.some(k=>['id','tenant_id','created_by','created_at','version'].includes(k)))throw Error('Identity fields may not be updated');const params=[this.tenant,uuid(rid),...keys.map(k=>value(k,data[k]))];
    const set=keys.map((k,i)=>`${k}=$${i+3}`).join(',')+(columns(table).includes('version')?',version=version+1':'');
    const r=(await this.client.query(`UPDATE cs.${table} SET ${set} WHERE tenant_id=$1 AND id=$2 RETURNING ${columns(table).join(',')}`,params)).rows[0];if(!r)fail(404,'NOT_FOUND','Record not found.');return r;}
  async period(rid,write=true){uuid(rid);const p=(await this.client.query('SELECT id,tenant_id,name,start_date,end_date,status,version FROM cs.periods WHERE tenant_id=$1 AND id=$2 FOR SHARE',[this.tenant,rid])).rows[0];
    if(!p)fail(404,'NOT_FOUND','Reporting period not found.');if(write&&p.status!=='OPEN')fail(409,'PERIOD_LOCKED','Reopen the period through the audited administration workflow before changing its data.');return p;}
  async userRef(rid,roles){const u=await this.get('users',rid);if(!u.active||(roles&&!roles.includes(u.role)))fail(422,'INVALID_ASSIGNEE','Select an active user with an appropriate role.');return u;}
  async location(campusId,departmentId=null){await this.get('campuses',campusId);if(departmentId){const d=await this.get('u_departments',departmentId);if(d.campus_id!==campusId)fail(422,'DEPARTMENT_CAMPUS','Department does not belong to this campus.');}}
  async evidence(ids,required=false){if(required&&!ids.length)fail(422,'EVIDENCE_REQUIRED','At least one clean, stored evidence document is required.');const output=[];
    for(const did of ids){const d=await this.get('documents',did,{share:true});if(d.scan_result!=='CLEAN'||!['REVIEW_REQUIRED','LINKED'].includes(d.status)||!d.object_version)fail(409,'EVIDENCE_NOT_READY','Evidence must be scanned clean and stored with a version.');
      output.push({id:d.id,name:d.original_name,sha256:d.sha256,objectVersion:d.object_version,sizeBytes:String(d.file_size),scanEngine:d.scan_engine,downloadPath:`/api/v2/documents/${d.id}/download`});}return output;}
  async audit(action,rid,details={}){await audit(this.client,this.user,action,rid,details);}
  async inventory(periodId,{limit=5000}={}){uuid(periodId);const rows=(await this.client.query('SELECT * FROM cs.u_inventory WHERE tenant_id=$1 AND period_id=$2 ORDER BY activity_date,id LIMIT $3',[this.tenant,periodId,limit+1])).rows;
    if(rows.length>limit)fail(422,'REPORT_SIZE_LIMIT','A synchronous snapshot supports at most 5000 calculation rows. Use the paginated inventory export and a reviewed offline report for a larger inventory.');return rows;}
  async inventoryPage(periodId,query={}){uuid(periodId);const limit=Number(query.limit??100);if(!Number.isInteger(limit)||limit<1||limit>500)fail(422,'INVALID_LIMIT','limit must be between 1 and 500.');
    let after=null;if(query.afterId)after=uuid(query.afterId);const rows=(await this.client.query(`SELECT * FROM cs.u_inventory WHERE tenant_id=$1 AND period_id=$2 ${after?'AND id>$4':''} ORDER BY id LIMIT $3`,[this.tenant,periodId,limit+1,...(after?[after]:[])])).rows;
    return {items:rows.slice(0,limit),nextAfterId:rows.length>limit?rows[limit-1].id:null,consistency:'Live keyset view. For a consistent export lock the period and do not reopen it during pagination.'};}
  async carbonAllocationUsed(instrumentId){const r=(await this.client.query(`SELECT coalesce(sum(a.quantity_kwh),0)::text AS used FROM cs.u_c_allocations a JOIN cs.u_c_records r ON r.tenant_id=a.tenant_id AND r.id=a.record_id WHERE a.tenant_id=$1 AND a.instrument_id=$2 AND r.status='CALCULATED' AND NOT EXISTS(SELECT 1 FROM cs.u_c_voids v WHERE v.tenant_id=r.tenant_id AND v.record_id=r.id AND v.status='APPROVED')`,[this.tenant,uuid(instrumentId)])).rows[0];return r.used;}
  async carbonActive(periodId){const rows=(await this.client.query('SELECT * FROM cs.u_c_active WHERE tenant_id=$1 AND period_id=$2 ORDER BY interval_end,id LIMIT 5001',[this.tenant,uuid(periodId)])).rows;if(rows.length>5000)fail(422,'REPORT_SIZE_LIMIT','Scope 1/2 synchronous export is bounded to 5000 records.');return rows;}
  async inventoryTotals(periodId){return (await this.client.query(`SELECT scope,category,campus_id,sum(kg_co2e)::text AS kg_co2e,count(*)::integer AS records,
    count(*) FILTER(WHERE evidence_count>0)::integer AS evidence_records FROM cs.u_inventory WHERE tenant_id=$1 AND period_id=$2 GROUP BY scope,category,campus_id ORDER BY scope,category,campus_id`,[this.tenant,uuid(periodId)])).rows;}
  async metricRows(periodId){const rows=(await this.client.query('SELECT * FROM cs.u_current_metrics WHERE tenant_id=$1 AND period_id=$2 ORDER BY interval_end,id LIMIT 5001',[this.tenant,uuid(periodId)])).rows;if(rows.length>5000)fail(422,'REPORT_SIZE_LIMIT','Metric snapshot exceeds 5000 rows.');return rows;}
  async missingTasks(periodId){return (await this.client.query(`SELECT t.id,t.campus_id,t.department_id,t.assignee_id,t.due_date,t.status,t.bucket,t.kpi_id,k.code,k.name,
    (t.due_date<CURRENT_DATE) AS overdue FROM cs.u_tasks t JOIN cs.u_kpis k ON k.tenant_id=t.tenant_id AND k.id=t.kpi_id
    WHERE t.tenant_id=$1 AND t.period_id=$2 AND t.status='OPEN' ORDER BY t.due_date,t.id LIMIT 5001`,[this.tenant,uuid(periodId)])).rows;}
  async searchApproved(term,periodId=null){const like='%'+term.replace(/[\\%_]/g,'\\$&')+'%';
    const rows=(await this.client.query(`SELECT 'emission'::text AS type,e.id AS record_id,e.description AS title,e.category AS category,e.period_id,c.provenance
      FROM cs.u_emissions e JOIN cs.u_calculations c ON c.tenant_id=e.tenant_id AND c.emission_id=e.id
      WHERE e.tenant_id=$1 AND e.status='CALCULATED' AND (e.description ILIKE $2 ESCAPE '\\' OR e.category ILIKE $2 ESCAPE '\\')
      AND ($3::uuid IS NULL OR e.period_id=$3) AND NOT EXISTS(SELECT 1 FROM cs.u_voids v WHERE v.tenant_id=e.tenant_id AND v.emission_id=e.id AND v.status='APPROVED')
      UNION ALL SELECT 'report'::text,r.id,r.title,r.purpose,r.period_id,jsonb_build_object('snapshotHash',r.snapshot_hash)
      FROM cs.u_reports r WHERE r.tenant_id=$1 AND r.status='APPROVED' AND r.title ILIKE $2 ESCAPE '\\' AND ($3::uuid IS NULL OR r.period_id=$3)
      ORDER BY type,record_id LIMIT 51`,[this.tenant,like,periodId])).rows;
    return {items:rows.slice(0,50),truncated:rows.length>50,searchType:'Escaped lexical search of approved university emissions and reports, not semantic AI search.'};}
}
/** Repeatable-read snapshots cannot be created by changing isolation after a first query. */
export async function universityTx(pool,user,fn,{snapshot=false}={}) {
  uuid(user.tenant_id);const client=guardClient(await pool.connect());let broken=false;
  try{await client.query(snapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN');await client.query("SELECT set_config('app.tenant_id',$1,true)",[user.tenant_id]);
    await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='25s'");const result=await fn(new UniversityStore(client,user));await client.query('COMMIT');return result;
  }catch(e){try{await client.query('ROLLBACK');}catch{broken=true;}throw e;}finally{client.release(broken);}
}
