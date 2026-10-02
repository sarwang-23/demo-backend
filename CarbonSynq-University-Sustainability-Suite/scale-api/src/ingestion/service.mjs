/** Import staging -> human-reviewed drafts. All writes run in the shared tenant transaction. */
import { fail, uuid, text, version, role, decimal } from '../core.mjs';
import { fields, reason, emissionInput, scaled, format as unscaled } from '../university/core.mjs';
import { authorOnly, taskAccess, createSubmission } from '../university/collection.mjs';
import { previewRecord, createRecord } from '../university/carbon/service.mjs';
import { validateEmission, createEmission } from '../university/emissions.mjs';
import { XLSX_MIME, exportWorkbook } from './parser.mjs';
import { FIELDS,LIMITS,key,normalizeValues,normalizedKey,workbookRows,invoiceRows,suggestSheet,suggestGroups,validatePlan,rowWarnings,safeCsvCell } from './normalize.mjs';
const WRITE=['ADMIN','ENTRY'];
const error=(code,message,field)=>({code,message,severity:'ERROR',...(field?{field}:{})});
const active=r=>!['SUPERSEDED'].includes(r.status);
export async function batchAccess(s,id,{write=false}={}){const b=await s.get('u_i_batches',uuid(id));if(s.user.role==='ENTRY'&&b.created_by!==s.user.id)fail(404,'NOT_FOUND','Import batch not found.');if(write){role(s.user,WRITE);authorOnly(s.user,b);if(!['OPEN','REVIEWING'].includes(b.status))fail(409,'BATCH_CLOSED','This batch is closed.');await s.period(b.period_id);}return b;}
async function batchLock(s,id){const b=await batchAccess(s,id);await s.lockKey('ingestion:'+b.id);await batchAccess(s,b.id,{write:true});return s.get('u_i_batches',b.id,{lock:true});}
async function fileAccess(s,id,{write=false}={}){const f=await s.get('u_i_files',uuid(id));const b=write?await batchLock(s,f.batch_id):await batchAccess(s,f.batch_id);return {file:await s.get('u_i_files',id,{lock:write}),batch:b};}
async function document(s,id){return s.get('documents',id);}
async function clean(s,id){await s.evidence([id],true);return document(s,id);}
export async function createBatch(s,b){role(s.user,WRITE);fields(b,['name','kind','target','periodId']);if(!['SPREADSHEET','INVOICE'].includes(b.kind)||!['CARBON','KPI','EMISSION'].includes(b.target))fail(422,'IMPORT_TYPE','Choose a supported file type and ledger target.');await s.period(uuid(b.periodId));const r=await s.insert('u_i_batches',{period_id:b.periodId,name:text(b.name,'name',180),kind:b.kind,target:b.target,status:'OPEN',created_by:s.user.id});await s.audit('I_BATCH_CREATED',r.id,{kind:r.kind,target:r.target});return r;}
export async function attachFiles(s,id,b){fields(b,['version','documentIds']);const batch=await batchLock(s,id);version(batch,b.version);if(!Array.isArray(b.documentIds)||b.documentIds.length<1||b.documentIds.length>LIMITS.files)fail(422,'FILES_LIMIT','Attach between 1 and 20 documents.');const old=await s.rows('u_i_files',{batch_id:id},LIMITS.files),all=[...new Set(b.documentIds.map(x=>uuid(x)))];if(new Set([...old.map(f=>f.document_id),...all]).size>LIMITS.files)fail(422,'FILES_LIMIT','A batch supports at most 20 files.');
 const docs=await Promise.all([...new Set([...old.map(f=>f.document_id),...all])].map(id=>document(s,id)));
 if(docs.reduce((n,d)=>n+Number(d.file_size),0)>LIMITS.batchBytes)fail(413,'BATCH_SIZE','Total files exceed 100 MiB.');
 for(const d of docs){if(s.user.role==='ENTRY'&&d.uploaded_by!==s.user.id)fail(404,'NOT_FOUND','Upload your own evidence or ask an administrator.');const allowed=batch.kind==='SPREADSHEET'?[XLSX_MIME,'text/csv']:['application/pdf'];if(!allowed.includes(d.mime_type))fail(422,'WRONG_BATCH_TYPE','This file does not match the batch type.');}
 const added=[];for(const did of all)if(!old.some(f=>f.document_id===did))added.push(await s.insert('u_i_files',{batch_id:id,document_id:did,plan:{},status:'ATTACHED',generation:0,created_by:s.user.id}));
 await s.audit('I_FILES_ATTACHED',id,{documentIds:all});return {batch:await s.update('u_i_batches',id,{status:'OPEN'}),files:added};
}
export async function getBatch(s,id){const batch=await batchAccess(s,id),files=await s.rows('u_i_files',{batch_id:id},LIMITS.files),rows=(await s.rows('u_i_rows',{batch_id:id},21000)).filter(active);const output=[];
 for(const f of files){const d=await document(s,f.document_id),subset=rows.filter(r=>r.file_id===f.id&&r.generation===f.generation);output.push({...f,document:{id:d.id,name:d.original_name,size:d.file_size,status:d.status,scanResult:d.scan_result,parserMethod:d.extraction?.method||null,parserError:d.extraction?.parserError||null},summary:counts(subset)});}
 return {...batch,files:output,summary:counts(rows),limits:LIMITS};
}
function counts(rows){return {total:rows.length,...Object.fromEntries(['REVIEW','INVALID','READY','SKIPPED','IMPORTED'].map(k=>[k.toLowerCase(),rows.filter(r=>r.status===k).length]))};}
export async function getFile(s,id){const {file,batch}=await fileAccess(s,id),d=await document(s,file.document_id),e=d.extraction;const preview=e?{...e,...(e.sheets?{sheets:e.sheets.map(sheet=>({...sheet,physicalRows:sheet.rows?.length||0,rows:(sheet.rows||[]).slice(0,50)}))}:{}),...(e.pages?{pages:e.pages.map(p=>({...p,text:p.text.slice(0,12000)}))}:{})}:null;
 return {file,batch,document:{id:d.id,name:d.original_name,status:d.status,scanResult:d.scan_result,sha256:d.sha256},extraction:preview,suggestions:batch.kind==='SPREADSHEET'?(e?.sheets||[]).map(suggestSheet):suggestGroups(e||{}),rows:await s.rows('u_i_rows',{file_id:id,generation:file.generation},LIMITS.rowsPerFile)};
}
function convertQuantity(quantity,from,to){if(from===to)return quantity;let x=scaled(quantity);if(from==='litre'&&to==='m3'){if(x%1000n)fail(422,'CONVERSION_PRECISION','Volume conversion would exceed six decimals; review the precision.');return unscaled(x/1000n);}if(from==='m3'&&to==='litre')return unscaled(x*1000n);fail(422,'UNIT_MISMATCH','Uploaded unit does not match the selected KPI/source; no density or gas-volume conversion is guessed.');}
async function resolveNamed(s,table,normalized,fieldsToMatch,filter={}){const candidates=await s.rows(table,filter,2000);const matches=candidates.filter(r=>fieldsToMatch.some(field=>key(r[field])===key(normalized)));if(matches.length!==1)fail(422,matches.length?'AMBIGUOUS_REFERENCE':'REFERENCE_NOT_FOUND','Map the uploaded label to one registered source/campus/KPI; no fuzzy match is applied.');return matches[0];}
async function buildTarget(s,batch,file,n,dedupe){
 await s.period(batch.period_id);const evidenceIds=[file.document_id];const description=n.description||`Reviewed upload ${file.document_id}; original row/page retained in import staging.`;
 if(batch.target==='CARBON'){
  const source=n.sourceId?await s.get('u_c_sources',uuid(n.sourceId)):await resolveNamed(s,'u_c_sources',n.sourceCode,['code','name']);
  if(n.sourceCode&&![source.code,source.name].some(value=>key(value)===key(n.sourceCode)))fail(422,'SOURCE_MISMATCH','The selected source ID conflicts with the uploaded source label. Map or explicitly correct it; a default must not override a different meter.');
  if(n.campusCode){const campus=await resolveNamed(s,'campuses',n.campusCode,['code','name']);if(campus.id!==source.campus_id)fail(422,'CAMPUS_MISMATCH','Source does not belong to the mapped campus.');}
  if(s.user.role==='ENTRY'&&source.owner_id!==s.user.id)fail(404,'NOT_FOUND','Source not found.');
  n.sourceId=source.id;n.sourceCode=source.code;
  const body={periodId:batch.period_id,sourceId:source.id,intervalStart:n.intervalStart,intervalEnd:n.intervalEnd,externalKey:'import:'+dedupe,description,quantityInput:{mode:'DIRECT',quantity:n.quantity,unit:n.unit},factorId:n.factorId,marketAllocations:[],fallbackFactorId:n.fallbackFactorId||undefined,fallbackReason:n.fallbackReason||undefined,evidenceIds,dataQuality:n.dataQuality||'MEASURED',assumptions:n.assumptions||'',zeroReason:n.zeroReason||undefined};
  await previewRecord(s,body);return body;
 }
 if(batch.target==='KPI'){
  let task;
  if(n.taskId)task=await s.get('u_tasks',uuid(n.taskId));
  else {
   const campus=await resolveNamed(s,'campuses',n.campusCode,['code','name']),kpi=await resolveNamed(s,'u_kpis',n.kpiCode,['code','name']);
   const matches=(await s.rows('u_tasks',{period_id:batch.period_id,campus_id:campus.id,kpi_id:kpi.id},2000)).filter(t=>t.interval_start===n.intervalStart&&t.interval_end===n.intervalEnd&&(s.user.role==='ADMIN'||t.assignee_id===s.user.id));
   if(matches.length!==1)fail(422,'TASK_MAPPING','Select a unique assigned KPI task for this exact campus and interval.');task=matches[0];
  }
  taskAccess(s.user,task,{write:true});if(task.period_id!==batch.period_id||task.interval_start!==n.intervalStart||task.interval_end!==n.intervalEnd)fail(422,'TASK_INTERVAL','Uploaded interval must exactly match the selected task.');
  if(task.status==='WAIVED')fail(409,'TASK_WAIVED','Selected task is waived.');
  const kpi=await s.get('u_kpis',task.kpi_id);if(n.kpiCode&&![kpi.code,kpi.name].some(v=>key(v)===key(n.kpiCode)))fail(422,'KPI_MISMATCH','Selected task conflicts with the uploaded KPI code.');if(n.campusCode){const c=await resolveNamed(s,'campuses',n.campusCode,['code','name']);if(c.id!==task.campus_id)fail(422,'CAMPUS_MISMATCH','Selected task conflicts with the uploaded campus.');}n.quantity=convertQuantity(n.quantity,n.unit,kpi.unit);n.unit=kpi.unit;n.taskId=task.id;n.kpiCode=kpi.code;
  decimal(n.quantity,'value',6,true);if(kpi.max_value!=null&&scaled(n.quantity)>scaled(kpi.max_value))fail(422,'RANGE_CHECK','Value exceeds the KPI maximum.');if(kpi.unit==='count'&&scaled(n.quantity)%1000000n)fail(422,'WHOLE_COUNT','Count must be a whole number.');if(kpi.unit==='percent'&&scaled(n.quantity)>100000000n)fail(422,'RANGE_CHECK','Percentage exceeds 100.');
  const prior=await s.rows('u_submissions',{task_id:task.id},100);if(prior.some(r=>['DRAFT','SUBMITTED','APPROVED'].includes(r.status)))fail(409,'EXISTING_TASK_DATA','This task already has data. Use the explicit correction workflow, not a second import.');
  return {taskId:task.id,taskVersion:task.version,value:n.quantity,unit:n.unit,notes:description,evidenceIds};
 }
 const campus=await resolveNamed(s,'campuses',n.campusCode,['code','name']);
 if(n.unit==='INR')fail(422,'SPEND_IMPORT_EXCLUDED','This consumption import does not turn invoice money into emissions. Use the separately reviewed spend-based entry workflow.');
 const body={periodId:batch.period_id,campusId:campus.id,category:n.category,unit:n.unit,quantity:n.quantity,activityDate:n.activityDate||n.intervalEnd,externalKey:'import:'+dedupe,description,factorId:n.factorId,dataQuality:n.dataQuality||'MEASURED',assumptions:n.assumptions||'',evidenceIds};
 const a=emissionInput(body);await validateEmission(s,a);if(await s.count('u_emissions',{external_key:body.externalKey}))fail(409,'DUPLICATE_SOURCE_KEY','This source key is already registered.');return body;
}
async function validateCandidate(s,batch,file,candidate,{excludeId=null,checkStaging=true}={}){
 let n={...candidate.normalized},issues=[...candidate.issues],payload=null;
 if(batch.kind==='INVOICE')for(const field of ['vendor','invoiceNumber'])if(!n[field])issues.push(error('INVOICE_IDENTITY','Confirm vendor and invoice number for duplicate detection.',field));
 if(n.unit==='INR')issues.push(error('MONEY_IS_NOT_CONSUMPTION','An INR amount must never be imported as physical consumption.','unit'));
 let dedupe=normalizedKey(batch.target,n);
 if(!issues.some(i=>i.severity==='ERROR'))try{payload=await buildTarget(s,batch,file,n,dedupe);dedupe=normalizedKey(batch.target,n);if(payload?.externalKey)payload.externalKey='import:'+dedupe;}catch(e){if(!e.status)throw e;issues.push(error(e.code,e.message));}
 if(checkStaging){const found=await s.rows('u_i_rows',{dedupe_key:dedupe,status:'IMPORTED'},1);if(found.some(r=>r.id!==excludeId))issues.push(error('ALREADY_IMPORTED','This normalized measurement/invoice has already been imported.'));}
 return {normalized:n,issues,target_payload:payload,dedupe_key:dedupe,status:issues.some(i=>i.severity==='ERROR')?'INVALID':'REVIEW'};
}
export async function previewFile(s,id,b){fields(b,['version','plans']);const {file,batch}=await fileAccess(s,id,{write:true});version(file,b.version);if(file.status==='SKIPPED')fail(409,'FILE_SKIPPED','Create another batch to reconsider an explicitly skipped file.');const d=await clean(s,file.document_id);if(!d.extraction)fail(409,'EXTRACTION_PENDING','Wait for the scanning/parser worker.');
 if(file.generation>=20)fail(422,'REVISION_LIMIT','Create a new batch after 20 mapping revisions.');
 const old=await s.rows('u_i_rows',{file_id:id,generation:file.generation},LIMITS.rowsPerFile);if(old.some(r=>r.status==='IMPORTED'))fail(409,'IMPORT_ALREADY_STARTED','Mapping is frozen after any row is imported. Correct remaining rows individually.');
 const plans=b.plans;if(!Array.isArray(plans)||!plans.length||plans.length>(batch.kind==='INVOICE'?1:10))fail(422,'PLANS_REQUIRED','Provide 1 invoice plan or 1-10 sheet plans.');
 if(batch.kind==='SPREADSHEET'&&new Set(plans.map(p=>p.sheet)).size!==plans.length)fail(422,'DUPLICATE_SHEET','A sheet may appear only once in a file plan.');
 const candidates=plans.flatMap(plan=>{validatePlan(plan,batch.kind);return (batch.kind==='SPREADSHEET'?workbookRows(d.extraction,plan):invoiceRows(d.extraction,plan)).map(c=>({...c,issues:[...c.issues,rowWarnings()]}));});
 if(!candidates.length)fail(422,'NO_ROWS','No data rows found below the selected header.');if(candidates.length>LIMITS.rowsPerFile)fail(422,'ROW_LIMIT','At most 500 normalized rows per file.');
 const history=await s.rows('u_i_rows',{batch_id:batch.id},21000);if(history.length+candidates.length>20000)fail(422,'HISTORY_LIMIT','This batch has reached its retained preview-history limit. Complete/cancel it and start a new batch.');const siblings=history.filter(r=>active(r)&&r.file_id!==id);if(siblings.length+candidates.length>LIMITS.rowsPerBatch)fail(422,'BATCH_ROW_LIMIT','At most 1000 active staged rows per batch.');
 const built=[];for(const c of candidates){const values=c.skipReason?{normalized:c.normalized,issues:c.issues,target_payload:null,dedupe_key:normalizedKey(batch.target,c.normalized),status:'SKIPPED'}:await validateCandidate(s,batch,file,c);built.push({...c,...values});}
 const keys=new Map();for(const r of [...siblings,...built].filter(r=>!['SKIPPED','SUPERSEDED'].includes(r.status)))keys.set(r.dedupe_key,(keys.get(r.dedupe_key)||0)+1);
 for(const c of built)if(c.status!=='SKIPPED'&&keys.get(c.dedupe_key)>1){c.issues.push(error('DUPLICATE_IN_BATCH','Another staged row has the same normalized identity. Explicitly skip the duplicate before confirming.'));c.status='INVALID';}
 for(const r of old)await s.update('u_i_rows',r.id,{status:'SUPERSEDED'});
 const generation=file.generation+1,rows=[];
 for(const [i,c] of built.entries())rows.push(await s.insert('u_i_rows',{batch_id:batch.id,file_id:id,generation,ordinal:i+1,target:batch.target,source_ref:c.source_ref,raw_values:c.raw_values,normalized:c.normalized,issues:c.issues,target_payload:c.target_payload,dedupe_key:c.dedupe_key,status:c.status,review_reason:c.skipReason?`Automatically excluded: ${c.skipReason}. Visible in the rejection export.`:null,reviewed_by:null,created_by:s.user.id}));
 const next=await s.update('u_i_files',id,{generation,plan:{plans},status:'PREVIEWED'});await s.update('u_i_batches',batch.id,{status:'REVIEWING'});await s.audit('I_FILE_NORMALIZED',id,{generation,rows:rows.length,sheets:plans.map(p=>p.sheet||'PDF pages')});return {file:next,rows,summary:counts(rows),note:'Staging only. No KPI or emissions record has been written.'};
}
export async function reviewRows(s,id,b){fields(b,['items','quantityMeaningConfirmed']);const batch=await batchLock(s,id);if(b.quantityMeaningConfirmed!==true)fail(422,'CONSUMPTION_CONFIRMATION','Confirm quantities are actual consumption or the intended KPI measurement, not money, purchased stock or cumulative meter totals.');
 if(!Array.isArray(b.items)||b.items.length<1||b.items.length>100)fail(422,'ROW_LIMIT','Review 1-100 rows per request.');if(new Set(b.items.map(i=>i.rowId)).size!==b.items.length)fail(422,'DUPLICATE_ROW','Select each row once.');const items=[];
 for(const item of b.items){fields(item,['rowId','version','overrides','reason','action']);const old=await s.get('u_i_rows',uuid(item.rowId),{lock:true});if(old.batch_id!==id)fail(404,'NOT_FOUND','Row not found.');version(old,item.version);if(['IMPORTED','SUPERSEDED'].includes(old.status))fail(409,'ROW_FROZEN','This row cannot be edited.');
  const file=await s.get('u_i_files',old.file_id);if(file.status==='SKIPPED')fail(409,'FILE_SKIPPED','The entire file was explicitly skipped.');const why=reason(item.reason);if(!['CONFIRM','SKIP'].includes(item.action))fail(422,'ROW_ACTION','Choose CONFIRM or SKIP.');
  if(item.action==='SKIP'){items.push(await s.update('u_i_rows',old.id,{status:'SKIPPED',review_reason:why,reviewed_by:s.user.id}));await s.audit('I_ROW_SKIPPED',old.id,{reason:why});continue;}
  fields(item.overrides||{},FIELDS);for(const v of Object.values(item.overrides||{}))if(v!=null&&String(v).length>2000)fail(422,'FIELD_LIMIT','A correction exceeds 2000 characters.');
  await clean(s,file.document_id);
  // Corrections apply to normalized canonical values, not to an already-converted raw number.
  const values={...old.normalized,...item.overrides},norm=normalizeValues(values,{dateOrder:'AUTO',numberFormat:'IN_EN'});
  const sticky=old.issues.filter(i=>['FORMULA_NOT_EVALUATED','EXCEL_ERROR','MERGED_VALUE','MULTIPLE_INVOICES'].includes(i.code)&&!Object.hasOwn(item.overrides||{},i.field));
  const prepared=await validateCandidate(s,batch,file,{normalized:norm.normalized,issues:[...norm.issues,...sticky,rowWarnings()]},{excludeId:old.id});
  const duplicates=(await s.rows('u_i_rows',{batch_id:id,dedupe_key:prepared.dedupe_key},1000)).filter(r=>r.id!==old.id&&!['SKIPPED','SUPERSEDED'].includes(r.status));
  if(duplicates.length)prepared.issues.push(error('DUPLICATE_IN_BATCH','Explicitly skip the other matching row before confirming this one.'));
  prepared.status=prepared.issues.some(i=>i.severity==='ERROR')?'INVALID':'READY';
  const row=await s.update('u_i_rows',old.id,{...prepared,review_reason:why,reviewed_by:s.user.id});items.push(row);await s.audit('I_ROW_REVIEWED',row.id,{action:row.status,changedFields:Object.keys(item.overrides||{}),reason:why});
 }
 return {items};
}
export async function commitRows(s,id,b){fields(b,['version','rowIds','confirmed']);const batch=await batchLock(s,id);version(batch,b.version);if(b.confirmed!==true)fail(422,'CONFIRM_REQUIRED','Confirm that the selected reviewed rows should be imported as drafts.');if(!Array.isArray(b.rowIds)||b.rowIds.length<1||b.rowIds.length>LIMITS.commitRows)fail(422,'COMMIT_LIMIT','Import 1-100 rows per atomic request.');if(new Set(b.rowIds).size!==b.rowIds.length)fail(422,'DUPLICATE_ROW','Select each row once.');
 const selected=[];for(const rid of b.rowIds){const r=await s.get('u_i_rows',uuid(rid),{lock:true});if(r.batch_id!==id)fail(404,'NOT_FOUND','Row not found.');if(r.status!=='READY'||!r.reviewed_by)fail(409,'ROW_NOT_READY','All selected rows must be explicitly reviewed and READY. No rows were imported.');selected.push(r);}
 if(new Set(selected.map(r=>r.dedupe_key)).size!==selected.length)fail(409,'DUPLICATE_IN_BATCH','Selected rows contain duplicate measurements.');
 // Sorted tenant-scoped locks prevent concurrent imports of the same identity across batches.
 for(const digest of selected.map(r=>r.dedupe_key).sort())await s.lockKey('import-identity:'+digest);
 const receipts=[];
 for(const row of selected){const file=await s.get('u_i_files',row.file_id);if(file.status!=='PREVIEWED')fail(409,'FILE_NOT_READY','Source file is not previewed.');await clean(s,file.document_id);
  const check=await validateCandidate(s,batch,file,{normalized:row.normalized,issues:[]},{excludeId:row.id});if(check.issues.some(i=>i.severity==='ERROR'))fail(409,'IMPORT_REVALIDATION','Data, period, factor or duplicate checks changed. No selected rows were imported.',{rowId:row.id,issues:check.issues});
  let record,link;
  if(batch.target==='CARBON'){record=await createRecord(s,check.target_payload);link={carbon_record_id:record.id};}
  else if(batch.target==='KPI'){const {taskId,...body}=check.target_payload;record=await createSubmission(s,taskId,body);link={submission_id:record.id};}
  else {record=await createEmission(s,check.target_payload);link={emission_id:record.id};}
  await s.update('u_i_rows',row.id,{status:'IMPORTED',...link});await s.audit('I_ROW_IMPORTED',row.id,{target:batch.target,recordId:record.id,dedupeKey:row.dedupe_key});receipts.push({rowId:row.id,recordId:record.id,target:batch.target,status:record.status});
 }
 const next=await s.update('u_i_batches',id,{status:'REVIEWING'});return {batch:next,imported:receipts.length,receipts,atomic:true,approvalRequired:true,note:'These are drafts. Independent approval and calculation still use the existing university workflow.'};
}
export async function skipFile(s,id,b){fields(b,['version','reason']);const {file,batch}=await fileAccess(s,id,{write:true});version(file,b.version);const rows=await s.rows('u_i_rows',{file_id:id,generation:file.generation},LIMITS.rowsPerFile);if(rows.some(r=>r.status==='IMPORTED'))fail(409,'IMPORTED_FILE','An imported file cannot be skipped. Correct the remaining rows individually.');const why=reason(b.reason);for(const r of rows)await s.update('u_i_rows',r.id,{status:'SKIPPED',review_reason:why,reviewed_by:s.user.id});const out=await s.update('u_i_files',id,{status:'SKIPPED',skip_reason:why});await s.audit('I_FILE_SKIPPED',file.id,{reason:why,batchId:batch.id});return out;}
export async function closeBatch(s,id,b){fields(b,['version','reason']);const batch=await batchLock(s,id);version(batch,b.version);const why=reason(b.reason),state=await getBatch(s,id);if(!state.files.length||state.files.some(f=>f.status==='ATTACHED')||state.summary.review||state.summary.invalid||state.summary.ready)fail(409,'UNRESOLVED_ROWS','Every file and row must be imported or explicitly skipped before completing the batch.');const out=await s.update('u_i_batches',id,{status:'COMPLETE',close_reason:why});await s.audit('I_BATCH_COMPLETED',id,{reason:why,summary:state.summary});return out;}
export async function cancelBatch(s,id,b){fields(b,['version','reason']);const batch=await batchLock(s,id);version(batch,b.version);if(await s.count('u_i_rows',{batch_id:id,status:'IMPORTED'}))fail(409,'IMPORT_ALREADY_STARTED','Imported drafts remain real records. Resolve remaining rows and complete this batch.');const why=reason(b.reason);const out=await s.update('u_i_batches',id,{status:'CANCELLED',close_reason:why});await s.audit('I_BATCH_CANCELLED',id,{reason:why});return out;}
export async function exportRows(s,id,format='xlsx',errorsOnly=false){const b=await batchAccess(s,id),files=await s.rows('u_i_files',{batch_id:id},LIMITS.files),names=new Map();for(const f of files)names.set(f.id,(await document(s,f.document_id)).original_name);const rows=(await s.rows('u_i_rows',{batch_id:id},21000)).filter(active).filter(r=>!errorsOnly||['INVALID','SKIPPED'].includes(r.status)).map(r=>({...r,filename:names.get(r.file_id),record_id:r.carbon_record_id||r.submission_id||r.emission_id||null}));
 const filename='normalized-'+id;
 if(format==='json')return {name:filename+'.json',mime:'application/json',bytes:Buffer.from(JSON.stringify({batch:b,rows},null,2))};
 if(format==='xlsx')return {name:filename+'.xlsx',mime:XLSX_MIME,bytes:await exportWorkbook(rows)};
 if(format!=='csv')fail(422,'EXPORT_FORMAT','Choose xlsx, csv or json.');const header=['rowId','filename','source','status',...FIELDS,'issues','reviewReason','recordId'];const lines=[header,...rows.map(r=>[r.id,r.filename,JSON.stringify(r.source_ref),r.status,...FIELDS.map(f=>r.normalized[f]||''),r.issues.map(i=>i.code+': '+i.message).join('; '),r.review_reason,r.record_id])];return {name:filename+'.csv',mime:'text/csv; charset=utf-8',bytes:Buffer.from('\ufeff'+lines.map(line=>line.map(safeCsvCell).join(',')).join('\r\n'))};
}
export async function saveTemplate(s,id,b){fields(b,['name']);const {file,batch}=await fileAccess(s,id);role(s.user,WRITE);authorOnly(s.user,batch);if(!file.plan?.plans)fail(422,'NO_PLAN','Preview the mapping before saving a template.');const r=await s.insert('u_i_templates',{name:text(b.name,'name',180),kind:batch.kind,target:batch.target,plan:file.plan,created_by:s.user.id});await s.audit('I_TEMPLATE_SAVED',r.id,{fileId:id});return r;}
export async function references(s,periodId){await s.period(uuid(periodId),false);const sourceFilters=s.user.role==='ENTRY'?{owner_id:s.user.id}:{},taskFilters={period_id:periodId,...(s.user.role==='ENTRY'?{assignee_id:s.user.id}:{})};return {sources:await s.rows('u_c_sources',sourceFilters,2000),carbonFactors:await s.rows('u_c_factors',{status:'APPROVED'},1000),campuses:await s.rows('campuses',{},1000),tasks:await s.rows('u_tasks',taskFilters,2000),kpis:await s.rows('u_kpis',{},1000),universityFactors:await s.rows('u_factors',{status:'APPROVED'},1000),fields:FIELDS,limits:LIMITS};}

export async function getBatchRows(s,id){await batchAccess(s,id);const files=await s.rows('u_i_files',{batch_id:id},LIMITS.files),names=new Map();for(const f of files)names.set(f.id,(await document(s,f.document_id)).original_name);const rows=(await s.rows('u_i_rows',{batch_id:id},21000)).filter(active);return {items:rows.map(r=>({...r,filename:names.get(r.file_id)})),summary:counts(rows)};}
