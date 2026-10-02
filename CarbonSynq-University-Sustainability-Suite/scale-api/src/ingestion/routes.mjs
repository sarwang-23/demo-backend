import * as svc from './service.mjs';
import { LIMITS,FIELDS } from './normalize.mjs';
const ALL=['ADMIN','ENTRY','REVIEWER','LEADERSHIP'],WRITE=['ADMIN','ENTRY'];
export function registerIngestionRoutes(route){
 const p='/ingestion';
 route('GET',p+'/capabilities',ALL,'Read import formats, normalization fields, limits and review requirements',async()=>({version:'ingestion-1',formats:['xlsx','csv','pdf'],limits:LIMITS,fields:FIELDS,ocrAvailable:process.env.OCR_ENABLED==='true',ocrMode:'EXPLICIT_CLEAN_DOCUMENT_JOB',formulaExecution:false,automaticApproval:false,batchTransport:'Bounded individual file uploads with persisted batch membership; not one large multipart request.'}));
 route('GET',p+'/references',ALL,'Read same-tenant sources, tasks and approved factors', (s,b,p,q)=>svc.references(s,q.periodId),{query:['periodId']});
 route('GET',p+'/batches',ALL,'List saved import batches', (s,b,p,q)=>s.listPage('u_i_batches',s.user.role==='ENTRY'?{created_by:s.user.id}:{},q),{query:['limit','cursor']});
 route('POST',p+'/batches',WRITE,'Create an Excel/CSV or multi-invoice import batch',svc.createBatch,{status:201});
 route('GET',p+'/batches/:id/rows',ALL,'Read all current staged rows across batch files',(s,b,p)=>svc.getBatchRows(s,p.id));
 route('GET',p+'/batches/:id',ALL,'Read durable per-file processing and import status',(s,b,p)=>svc.getBatch(s,p.id));
 route('POST',p+'/batches/:id/files',WRITE,'Attach uploaded document IDs to the batch',(s,b,p)=>svc.attachFiles(s,p.id,b),{status:201});
 route('GET',p+'/files/:id',ALL,'Read sheet/page previews, mapping suggestions and staged rows',(s,b,p)=>svc.getFile(s,p.id));
 route('POST',p+'/files/:id/preview',WRITE,'Normalize selected sheets or invoice page groups into staging only',(s,b,p)=>svc.previewFile(s,p.id,b));
 route('POST',p+'/files/:id/skip',WRITE,'Explicitly exclude a file with an audit reason',(s,b,p)=>svc.skipFile(s,p.id,b));
 route('POST',p+'/batches/:id/review',WRITE,'Correct, confirm or skip up to 100 staged rows',(s,b,p)=>svc.reviewRows(s,p.id,b));
 route('POST',p+'/batches/:id/commit',WRITE,'Atomically import selected READY rows as reviewable drafts',(s,b,p)=>svc.commitRows(s,p.id,b),{status:201});
 route('POST',p+'/batches/:id/complete',WRITE,'Complete a batch after every file and row is resolved',(s,b,p)=>svc.closeBatch(s,p.id,b));
 route('POST',p+'/batches/:id/cancel',WRITE,'Cancel an uncommitted batch without deleting evidence',(s,b,p)=>svc.cancelBatch(s,p.id,b));
 route('GET',p+'/batches/:id/export',ALL,'Export normalized rows and errors as XLSX, CSV or JSON',(s,b,p,q)=>svc.exportRows(s,p.id,q.format||'xlsx',q.errorsOnly==='true'),{query:['format','errorsOnly'],file:true});
 route('GET',p+'/templates',ALL,'List reusable tenant-scoped mapping templates',(s,b,p,q)=>s.listPage('u_i_templates',{},q),{query:['limit','cursor']});
 route('POST',p+'/files/:id/template',WRITE,'Save the reviewed sheet/page mapping as a reusable template',(s,b,p)=>svc.saveTemplate(s,p.id,b),{status:201});
}
