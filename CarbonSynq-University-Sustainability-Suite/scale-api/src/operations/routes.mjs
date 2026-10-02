import { setTimeout as sleep } from 'node:timers/promises';
import { role, uuid, hash, fail, pagination, page } from '../core.mjs';
import { fields } from '../university/core.mjs';
import { universityTx } from '../university/store.mjs';
import { idempotent } from '../db.mjs';
import { rateLimit } from '../auth.mjs';
import { OperationsStore } from './store.mjs';
import * as management from './management.mjs';
import * as accounts from './accounts.mjs';
import * as exports from './exports.mjs';
import { parseCredential, operationsConfig } from './crypto.mjs';
const ALL=['ADMIN','ENTRY','REVIEWER','LEADERSHIP'],ADMIN=['ADMIN'],REVIEW=['ADMIN','REVIEWER'],READ=['ADMIN','REVIEWER','LEADERSHIP'];
export const OPS_ROUTES=[];
function route(method,path,roles,summary,fn,{query=[],secret=false,file=false}={}){const names=[];const regex=new RegExp('^/api/v2/operations'+path.replace(/:([A-Za-z]+)/g,(_,n)=>{names.push(n);return '([^/]+)';})+'$');OPS_ROUTES.push({method,path:'/api/v2/operations'+path,roles,summary,fn,query,secret,file,regex,names});}
route('GET','/capabilities',ALL,'Read actual operations configuration and explicit limits',async(s,b,p,q,ctx)=>({version:'2.4.0-operations-rc.1',mailMode:ctx.cfg.mailMode,emailDeliveryConfigured:ctx.cfg.mailMode==='webhook',localCaptureNotEmail:ctx.cfg.mailMode==='capture',ocrEnabled:ctx.cfg.ocrEnabled,ocrLanguage:'eng',departmentEvidenceSharing:true,staffInvitations:true,passwordRecovery:ctx.cfg.mailMode!=='disabled',inAppNotifications:true,asynchronousInventoryExports:true,exportLimits:{rows:ctx.cfg.exportMaxRows,bytes:ctx.cfg.exportMaxBytes},evidencePolicy:'ADMIN, REVIEWER and LEADERSHIP have university-wide evidence access. ENTRY can read own, explicitly granted and matching department/campus-shared evidence. No full multi-role departmental ABAC claim.',retention:'Holds and dependency review only. Automatic destructive deletion is not implemented.'}));
route('POST','/staff/invite',ADMIN,'Queue a single-use staff invitation after administrator password confirmation',(s,b,p,q,c)=>accounts.inviteStaff(s,b,c.cfg),{secret:true});
route('GET','/staff/invitations',ADMIN,'List staff invitations without exposing token hashes or tokens',async(s,b,p,q)=>{
 const {limit,cursor}=pagination(q);return page((await s.client.query(`SELECT id,email,name,role,expires_at,consumed_at,revoked_at,created_at FROM cs.u_o_credentials WHERE tenant_id=$1 AND purpose='INVITE' ${cursor?'AND (created_at,id)<($3::timestamptz,$4::uuid)':''} ORDER BY created_at DESC,id DESC LIMIT $2`,[s.tenant,limit+1,...(cursor||[])])).rows,limit);
},{query:['limit','cursor']});
route('POST','/staff/invitations/:id/revoke',ADMIN,'Revoke an unconsumed staff invitation',(s,b,p)=>accounts.revokeInvitation(s,p.id,b));
route('GET','/memberships',ADMIN,'Page active and revoked campus/department memberships',(s,b,p,q)=>s.listPage('u_o_memberships',q.userId?{user_id:uuid(q.userId)}:{},q),{query:['userId','limit','cursor']});
route('POST','/memberships',ADMIN,'Create or revoke an explicit evidence-scope membership',management.membership);
route('GET','/documents/:id/access',ADMIN,'Read the explicit evidence scope, holds and grants',async(s,b,p)=>({document:await s.get('documents',uuid(p.id)),scope:(await s.rows('u_o_document_scopes',{document_id:p.id},1))[0]||{version:0,visibility:'PRIVATE'},grants:await s.rows('u_o_document_grants',{document_id:p.id},500)}));
route('POST','/documents/:id/scope',ADMIN,'Change document sharing scope with an audit reason',(s,b,p)=>management.documentScope(s,p.id,b));
route('POST','/documents/:id/grant',ADMIN,'Grant or revoke one named user evidence access',(s,b,p)=>management.evidenceGrant(s,p.id,b));
route('POST','/documents/:id/hold',ADMIN,'Set or release an evidence retention hold without deleting bytes',(s,b,p)=>management.holdEvidence(s,p.id,b));
route('GET','/documents/:id/dependencies',ADMIN,'Review evidence dependencies before any manual retention decision',async(s,b,p)=>{
 const doc=await s.get('documents',uuid(p.id));const result={documentId:doc.id,originalPreserved:true,automaticDeletionSupported:false,scope:(await s.rows('u_o_document_scopes',{document_id:doc.id},1))[0]||null,references:[]};
 const sources=[['activities','document_id'],['u_i_files','document_id']];for(const [t,col]of sources){const r=await s.client.query(`SELECT count(*)::integer AS n FROM cs.${t} WHERE tenant_id=$1 AND ${col}=$2`,[s.tenant,doc.id]);if(r.rows[0].n)result.references.push({table:t,count:r.rows[0].n});}
 for(const t of ['u_submissions','u_emissions','u_supplier_requests','u_c_boundaries','u_c_records','u_c_actions','u_c_instruments']){const r=await s.client.query(`SELECT count(*)::integer AS n FROM cs.${t} WHERE tenant_id=$1 AND evidence_ids ? $2`,[s.tenant,doc.id]);if(r.rows[0].n)result.references.push({table:t,count:r.rows[0].n});}
 const reports=await s.client.query('SELECT count(*)::integer AS n FROM cs.u_reports WHERE tenant_id=$1 AND snapshot::text LIKE $2',[s.tenant,'%'+doc.id+'%']);if(reports.rows[0].n)result.references.push({table:'u_reports',count:reports.rows[0].n});return result;
});
route('POST','/tasks/:id/reassign',ADMIN,'Transfer an open task without changing historical authorship',(s,b,p)=>management.reassignTask(s,p.id,b));
route('POST','/sources/:id/reassign',ADMIN,'Transfer only source ownership; accounting identity stays immutable',(s,b,p)=>management.reassignSource(s,p.id,b));
route('POST','/actions/:id/reassign',ADMIN,'Transfer responsibility for an open corrective action',(s,b,p)=>management.reassignAction(s,p.id,b));
route('GET','/reassignments',ADMIN,'Page immutable operational transfer history',(s,b,p,q)=>s.listPage('u_o_reassignments',{},q),{query:['limit','cursor']});
route('GET','/notifications',ALL,'Read your own in-app notification inbox',(s,b,p,q)=>s.listPage('u_o_notifications',{user_id:s.user.id,...(q.unreadOnly==='true'?{read_at:null}:{})},q),{query:['limit','cursor','unreadOnly']});
route('POST','/notifications/:id/read',ALL,'Mark your own notification read',(s,b,p)=>management.markRead(s,p.id,b));
route('GET','/preferences',ALL,'Read your own notification preferences',async s=>(await s.rows('u_o_preferences',{user_id:s.user.id},1))[0]||{version:0,email_enabled:false,reminders_enabled:true});
route('POST','/preferences',ALL,'Update your own reminder/email preferences',management.preferences);
route('GET','/outbox',ADMIN,'Page delivery statuses without exposing bodies or credential links',async(s,b,p,q)=>{
 const {limit,cursor}=pagination(q);return page((await s.client.query(`SELECT id,kind,status,delivery_id,error_code,created_at,delivered_at,expires_at FROM cs.u_o_mail WHERE tenant_id=$1 ${cursor?'AND (created_at,id)<($3::timestamptz,$4::uuid)':''} ORDER BY created_at DESC,id DESC LIMIT $2`,[s.tenant,limit+1,...(cursor||[])])).rows,limit);
},{query:['limit','cursor']});
route('POST','/exports',ADMIN,'Schedule a locked-period inventory export for independent approval',exports.requestExport);
route('GET','/exports',READ,'Page background inventory export status',async(s,b,p,q)=>{const out=await s.listPage('u_o_exports',q.periodId?{period_id:uuid(q.periodId)}:{},q);out.items=out.items.map(exports.publicExport);return out;},{query:['periodId','limit','cursor']});
route('GET','/exports/:id',READ,'Read an export manifest and current period version',async(s,b,p)=>{const r=await s.get('u_o_exports',uuid(p.id)),period=await s.period(r.period_id,false);return {...exports.publicExport(r),supersededByPeriodChange:r.period_version!==period.version,currentPeriodStatus:period.status};});
route('POST','/exports/:id/review',REVIEW,'Independently approve or reject a completed inventory export',(s,b,p)=>exports.reviewExport(s,p.id,b));
route('GET','/exports/:id/preview',REVIEW,'Download exact bytes for review before publication',(s,b,p,q,c)=>exports.downloadExport(s,c.storage,p.id,{preview:true}),{file:true});
route('GET','/exports/:id/download',READ,'Download a hash-verified internally approved inventory export',(s,b,p,q,c)=>exports.downloadExport(s,c.storage,p.id),{file:true});
route('POST','/documents/:id/ocr',['ADMIN','ENTRY'],'Request bounded local English OCR on a clean unimported document',(s,b,p,q,c)=>management.requestOcr(s,p.id,b,c.cfg));
route('GET','/ocr',ALL,'Page OCR runs visible to the uploader or university reviewer',(s,b,p,q)=>s.listPage('u_o_ocr_runs',s.user.role==='ENTRY'?{created_by:s.user.id}:{},q),{query:['limit','cursor']});
export function matchOperation(method,path){for(const r of OPS_ROUTES){const m=r.method===method&&r.regex.exec(path);if(m)return {route:r,params:Object.fromEntries(r.names.map((n,i)=>[n,m[i+1]]))};}fail(404,'NOT_FOUND','Operations API route not found.');}
export async function operationsTx(pool,user,fn){return universityTx(pool,user,async base=>{
 const s=new OperationsStore(base.client,user);
 // A tenant lock precedes account locks. Administrative role changes cannot race
 // an already-authorized operations transaction. Public recovery stays generic.
 if(user.role!=='RECOVERY'){
  if(!await s.activeTenant())fail(401,'UNAUTHENTICATED','University is not active.');
  const current=await s.accountById(user.id,true);
  if(!current?.active||current.role!==user.role)fail(401,'UNAUTHENTICATED','Account access changed. Sign in again.');
 }
 return fn(s);
});}
export async function dispatchOperations(pool,request,context){const {user,method,path,query={},body={},key}=request,{route:r,params}=matchOperation(method,path);role(user,r.roles);fields(query,r.query);
 const result=await operationsTx(pool,user,s=>{const run=()=>r.fn(s,body,params,query,context);return method==='GET'||r.secret?run():idempotent(s.client,user,'ops:'+method+':'+path,key,{body,query},run);});
 return r.file?{file:result}:{data:result,status:method==='POST'?200:200};
}
export async function publicAccount(pool,{path,body,ip,requestId},cfg) {
 await rateLimit(pool,'account-public:'+ip,20,900);
 if(path==='/api/v2/account/recover'){
  fields(body,['tenantId','email']);const tenantId=uuid(body.tenantId),email=accounts.normalizeEmail(body.email);
  await rateLimit(pool,'account-recovery:'+tenantId+':'+hash(email),4,3600);
  const started=Date.now();try{return await operationsTx(pool,{tenant_id:tenantId,id:null,role:'RECOVERY',requestId},s=>accounts.requestReset(s,body,cfg));}
  finally{await sleep(Math.max(0,300-(Date.now()-started)));}
 }
 if(path==='/api/v2/account/complete'){
  const parsed=parseCredential(body.token);await rateLimit(pool,'account-token:'+hash(body.token),10,900);const encoded=await accounts.preparePassword(body);
  return operationsTx(pool,{tenant_id:parsed.tenantId,id:null,role:'RECOVERY',requestId},s=>accounts.consumeLink(s,body,encoded));
 }
 fail(404,'NOT_FOUND','Account route not found.');
}
