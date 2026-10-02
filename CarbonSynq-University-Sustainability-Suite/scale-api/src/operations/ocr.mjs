import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash, fail } from '../core.mjs';
import { tenantTx, audit } from '../db.mjs';
import { ownedJob, done } from '../jobs.mjs';
import { parseInvoiceText } from '../invoice-text.mjs';
export function runOcr(bytes,mime,{python=process.env.PARSER_PYTHON||'python3',timeoutMs=80000}={}) {
 const kind={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpeg'}[mime];
 if(!kind)throw Error('Unsupported OCR MIME');
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[fileURLToPath(new URL('../../python/ocr_document.py',import.meta.url)),kind],{shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:{...Object.fromEntries(['PATH','LANG','LC_ALL','TMPDIR','TEMP','TMP','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',OMP_THREAD_LIMIT:'1',OPENBLAS_NUM_THREADS:'1'}});
  let finished=false,length=0,diagnostics=0;const chunks=[];
  const stop=()=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);stop();error?reject(error):resolve(result);};
  const error=(code,message)=>Object.assign(Error(message),{code});
  const timer=setTimeout(()=>finish(error('OCR_TIMEOUT','OCR exceeded its time budget. Original evidence is unchanged.')),timeoutMs);
  child.on('error',()=>finish(error('OCR_UNAVAILABLE','Local OCR interpreter unavailable.')));
  child.stdout.on('data',chunk=>{length+=chunk.length;if(length>8*1024*1024)return finish(error('OCR_OUTPUT_LIMIT','OCR result is too large.'));chunks.push(chunk);});
  child.stderr.on('data',chunk=>{diagnostics+=chunk.length;if(diagnostics>65536)finish(error('OCR_OUTPUT_LIMIT','OCR diagnostics exceeded the limit.'));});child.stdin.on('error',()=>{});
  child.on('close',()=>{if(finished)return;try{const r=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!r.ok)return finish(error(r.error.code,r.error.message));const parsed=parseInvoiceText(r.data.pages.map(p=>p.text).join('\n'));finish(null,{...r.data,fields:parsed.fields,fieldsDetected:Object.keys(parsed.fields),warnings:[...r.data.warnings,...parsed.warnings]});}catch{finish(error('OCR_FAILED','OCR did not return a valid result.'));}});
  child.stdin.end(bytes);
 });
}
export async function processOcr(pool,storage,job,cfg,engine=runOcr) {
 if(!cfg.ocrEnabled)throw Object.assign(Error('OCR is disabled'),{code:'OCR_DISABLED'});
 const work=await tenantTx(pool,job.tenant_id,async c=>{
  await ownedJob(c,job);const tenant=(await c.query('SELECT status FROM cs.tenants WHERE id=$1',[job.tenant_id])).rows[0];if(tenant?.status!=='ACTIVE')fail(409,'TENANT_SUSPENDED','University is suspended.');const run=(await c.query('SELECT * FROM cs.u_o_ocr_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[job.tenant_id,job.entity_id])).rows[0];
  if(!run)fail(404,'NOT_FOUND','OCR run not found.');if(['COMPLETE','CANCELLED'].includes(run.status)){await done(c,job);return null;}
  const d=(await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2',[job.tenant_id,run.document_id])).rows[0];
  if(d?.status!=='REVIEW_REQUIRED'||d.scan_result!=='CLEAN'||d.version!==run.document_version||d.sha256!==run.input_sha256)fail(409,'OCR_STALE_DOCUMENT','Evidence changed. Request a new OCR review.');
  await c.query("UPDATE cs.u_o_ocr_runs SET status='PROCESSING',error_code=NULL,version=version+1 WHERE tenant_id=$1 AND id=$2",[job.tenant_id,run.id]);return {run,d};
 });
 if(!work)return;
 const {run,d}=work,bytes=await storage.get(d.object_key,d.object_version,Number(d.file_size));
 if(bytes.length!==Number(d.file_size)||hash(bytes)!==d.sha256)fail(503,'EVIDENCE_INTEGRITY','Original bytes failed integrity validation.');
 const extraction=await engine(bytes,d.mime_type);
 await tenantTx(pool,job.tenant_id,async c=>{
  await ownedJob(c,job);
  const tenant=(await c.query('SELECT status FROM cs.tenants WHERE id=$1 FOR SHARE',[job.tenant_id])).rows[0];if(tenant?.status!=='ACTIVE')fail(409,'TENANT_SUSPENDED','University is suspended.');
  const current=(await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[job.tenant_id,d.id])).rows[0];
  if(current.version!==run.document_version||current.scan_result!=='CLEAN'||current.status!=='REVIEW_REQUIRED')fail(409,'OCR_STALE_DOCUMENT','Evidence changed while OCR was running.');
  const used=await c.query("SELECT 1 FROM cs.u_i_rows r JOIN cs.u_i_files f ON f.tenant_id=r.tenant_id AND f.id=r.file_id WHERE r.tenant_id=$1 AND f.document_id=$2 AND r.status='IMPORTED' LIMIT 1",[job.tenant_id,d.id]);if(used.rows.length)fail(409,'ALREADY_IMPORTED','Evidence was imported while OCR was running. Existing provenance remains unchanged.');
  await c.query('UPDATE cs.documents SET extraction=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2',[job.tenant_id,d.id,JSON.stringify(extraction)]);
  await c.query("UPDATE cs.u_o_ocr_runs SET status='COMPLETE',result_summary=$3,error_code=NULL,version=version+1 WHERE tenant_id=$1 AND id=$2",[job.tenant_id,run.id,JSON.stringify({engine:extraction.engine,pageCount:extraction.pageCount,ocrPages:extraction.ocrPages,needsHumanReview:true,sha256:d.sha256})]);
  await audit(c,{tenant_id:job.tenant_id},'O_OCR_COMPLETED',d.id,{runId:run.id,engine:extraction.engine,needsHumanReview:true});await done(c,job);
 });
}
