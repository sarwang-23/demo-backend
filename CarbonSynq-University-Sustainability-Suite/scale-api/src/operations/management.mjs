import { id, role, version, fail, uuid } from '../core.mjs';
import { fields, reason, text } from '../university/core.mjs';
const ADMIN=['ADMIN'];
export async function membership(s,b) {
 role(s.user,ADMIN);fields(b,['id','version','userId','campusId','departmentId','active','reason']);const why=reason(b.reason);
 if(typeof b.active!=='boolean')fail(422,'INVALID_ACTIVE','active must be a boolean.');
 await s.userRef(uuid(b.userId));await s.location(uuid(b.campusId),b.departmentId?uuid(b.departmentId):null);
 await s.lockKey(`membership:${b.userId}:${b.campusId}:${b.departmentId||'*'}`);
 const prior=b.id?await s.get('u_o_memberships',uuid(b.id),{lock:true}):(await s.rows('u_o_memberships',{user_id:b.userId,campus_id:b.campusId,department_id:b.departmentId||null},1))[0];
 const data={user_id:b.userId,campus_id:b.campusId,department_id:b.departmentId||null,active:b.active};
 if(prior){version(prior,b.version);if(prior.user_id!==b.userId||prior.campus_id!==b.campusId||prior.department_id!==(b.departmentId||null))fail(422,'IMMUTABLE_SCOPE','Revoke this membership and create another scope instead.');}
 const r=prior?await s.update('u_o_memberships',prior.id,{active:b.active}):await s.insert('u_o_memberships',{...data,created_by:s.user.id});
 await s.audit('O_MEMBERSHIP_CHANGED',r.id,{before:prior||null,after:r,reason:why});return r;
}
async function scopeFor(s,documentId){await s.get('documents',uuid(documentId));await s.lockKey('evidence-scope:'+documentId);return (await s.rows('u_o_document_scopes',{document_id:documentId},1))[0]||null;}
export async function documentScope(s,documentId,b) {
 role(s.user,ADMIN);fields(b,['version','visibility','campusId','departmentId','reason']);const why=reason(b.reason);
 if(!['PRIVATE','CAMPUS','DEPARTMENT'].includes(b.visibility))fail(422,'INVALID_SCOPE','Choose PRIVATE, CAMPUS or DEPARTMENT.');
 let campus=null,department=null;
 if(b.visibility!=='PRIVATE'){campus=uuid(b.campusId);department=b.visibility==='DEPARTMENT'?uuid(b.departmentId):null;await s.location(campus,department);}
 else if(b.campusId||b.departmentId)fail(422,'INVALID_SCOPE','A private document has no shared campus/department.');
 if(b.visibility==='CAMPUS'&&b.departmentId)fail(422,'INVALID_SCOPE','Use DEPARTMENT visibility for a department.');
 const old=await scopeFor(s,documentId);if(old)version(old,b.version);else if(b.version!==0)fail(409,'STALE_VERSION','A document without scope has version 0.');
 const data={visibility:b.visibility,campus_id:campus,department_id:department};
 const r=old?await s.update('u_o_document_scopes',old.id,data):await s.insert('u_o_document_scopes',{document_id:documentId,...data,created_by:s.user.id});
 await s.audit('O_EVIDENCE_SCOPE_CHANGED',documentId,{before:old,after:r,reason:why});return r;
}
export async function evidenceGrant(s,documentId,b) {
 role(s.user,ADMIN);fields(b,['userId','version','active','reason']);const why=reason(b.reason);await s.get('documents',uuid(documentId));await s.userRef(uuid(b.userId));
 if(typeof b.active!=='boolean')fail(422,'INVALID_ACTIVE','active must be boolean.');await s.lockKey('evidence-grant:'+documentId+':'+b.userId);
 const old=(await s.rows('u_o_document_grants',{document_id:documentId,user_id:b.userId},1))[0];if(old)version(old,b.version);else if(b.version!==0)fail(409,'STALE_VERSION','A new grant uses version 0.');
 const r=old?await s.update('u_o_document_grants',old.id,{active:b.active}):await s.insert('u_o_document_grants',{document_id:documentId,user_id:b.userId,active:b.active,created_by:s.user.id});
 await s.audit('O_EVIDENCE_GRANT_CHANGED',documentId,{userId:b.userId,active:b.active,reason:why});return r;
}
export async function holdEvidence(s,documentId,b,{now=new Date()}={}) {
 role(s.user,ADMIN);fields(b,['version','hold','until','reason']);const why=reason(b.reason);if(typeof b.hold!=='boolean')fail(422,'INVALID_HOLD','hold must be boolean.');
 let until=null;if(b.hold&&b.until){const date=new Date(b.until);if(!Number.isFinite(+date)||+date<=+now)fail(422,'INVALID_DATE','Hold expiry must be in the future.');until=date.toISOString();}
 const old=await scopeFor(s,documentId);if(old)version(old,b.version);else if(b.version!==0)fail(409,'STALE_VERSION','A new document policy uses version 0.');
 const data={hold_until:until,hold_reason:b.hold?why:null};
 const r=old?await s.update('u_o_document_scopes',old.id,data):await s.insert('u_o_document_scopes',{document_id:documentId,visibility:'PRIVATE',campus_id:null,department_id:null,...data,created_by:s.user.id});
 await s.audit(b.hold?'O_EVIDENCE_HOLD_SET':'O_EVIDENCE_HOLD_RELEASED',documentId,{reason:why,until,indefinite:b.hold&&!until});return r;
}
async function reassignmentAudit(s,kind,target,before,after,why){const event=await s.insert('u_o_reassignments',{kind,target_id:target,before_state:before,after_state:after,reason:why,created_by:s.user.id});return event.id;}
export async function reassignTask(s,taskId,b) {
 role(s.user,ADMIN);fields(b,['version','assigneeId','reviewerId','returnPending','reason']);const why=reason(b.reason);
 const seen=await s.get('u_tasks',uuid(taskId));await s.period(seen.period_id);const task=await s.get('u_tasks',taskId,{lock:true});version(task,b.version);
 if(task.status!=='OPEN')fail(409,'TASK_NOT_OPEN','Only outstanding open tasks may be transferred. Historical completed/waived tasks stay unchanged.');
 await s.userRef(uuid(b.assigneeId),['ADMIN','ENTRY']);await s.userRef(uuid(b.reviewerId),['ADMIN','REVIEWER']);if(b.assigneeId===b.reviewerId)fail(422,'SEPARATE_REVIEWER','Assignee and reviewer must be different people.');
 const pending=(await s.rows('u_submissions',{task_id:task.id},100)).filter(r=>['DRAFT','SUBMITTED'].includes(r.status));
 if(pending.length&&b.returnPending!==true)fail(409,'PENDING_SUBMISSIONS','Explicitly return pending drafts/submissions before transferring responsibility. No author is silently changed.');
 for(const p of pending){await s.update('u_submissions',p.id,{status:'REJECTED',rejection_reason:'Responsibility transferred: '+why});await s.audit('U_SUBMISSION_REJECTED',p.id,{reason:why,reassignment:true});}
 const result=await s.update('u_tasks',task.id,{assignee_id:b.assigneeId,reviewer_id:b.reviewerId});
 const rid=await reassignmentAudit(s,'TASK',task.id,{assigneeId:task.assignee_id,reviewerId:task.reviewer_id},{assigneeId:result.assignee_id,reviewerId:result.reviewer_id,returnedSubmissionIds:pending.map(p=>p.id)},why);
 await s.audit('O_TASK_REASSIGNED',task.id,{reassignmentId:rid,reason:why});return {...result,returnedSubmissionIds:pending.map(p=>p.id),note:'Prior authorship and approved snapshots remain unchanged. New assignee creates their own revision; evidence access must be granted explicitly.'};
}
export async function reassignSource(s,sourceId,b) {
 role(s.user,ADMIN);fields(b,['ownershipVersion','ownerId','returnPending','reason']);const why=reason(b.reason);await s.lockKey('scope12-governance');await s.lockKey('source-transfer:'+uuid(sourceId));
 const source=await s.get('u_c_sources',sourceId,{lock:true});if(source.ownership_version!==b.ownershipVersion)fail(409,'STALE_VERSION','Source ownership changed. Reload.');
 await s.userRef(uuid(b.ownerId),['ADMIN','ENTRY']);
 const pending=await s.rows('u_c_records',{source_id:sourceId,status:['DRAFT','SUBMITTED']},100);
 if(pending.length&&b.returnPending!==true)fail(409,'PENDING_RECORDS','Explicitly return outstanding records before changing source ownership.');
 for(const record of pending){await s.period(record.period_id);await s.update('u_c_records',record.id,{status:'REJECTED',rejection_reason:'Responsibility transferred: '+why});}
 const r=await s.transferSource(sourceId,b.ownerId,b.ownershipVersion);
 const rid=await reassignmentAudit(s,'SOURCE',sourceId,{ownerId:source.owner_id},{ownerId:r.owner_id,returnedRecordIds:pending.map(p=>p.id)},why);
 await s.audit('O_SOURCE_REASSIGNED',sourceId,{reassignmentId:rid,reason:why});return {...r,returnedRecordIds:pending.map(p=>p.id)};
}
export async function reassignAction(s,actionId,b) {
 role(s.user,ADMIN);fields(b,['version','ownerId','reason']);const why=reason(b.reason);const seen=await s.get('u_c_actions',uuid(actionId));await s.period(seen.period_id);const r=await s.get('u_c_actions',actionId,{lock:true});version(r,b.version);
 if(r.status!=='OPEN')fail(409,'INVALID_STATE','Only an open corrective action can be reassigned.');await s.userRef(uuid(b.ownerId),['ADMIN','ENTRY','REVIEWER']);const result=await s.update('u_c_actions',r.id,{owner_id:b.ownerId});
 await reassignmentAudit(s,'ACTION',r.id,{ownerId:r.owner_id},{ownerId:result.owner_id},why);await s.audit('O_ACTION_REASSIGNED',r.id,{reason:why});return result;
}
export async function preferences(s,b) {
 fields(b,['version','emailEnabled','remindersEnabled']);if(typeof b.emailEnabled!=='boolean'||typeof b.remindersEnabled!=='boolean')fail(422,'INVALID_PREFERENCE','Both preferences must be boolean.');await s.lockKey('preferences:'+s.user.id);
 const old=(await s.rows('u_o_preferences',{user_id:s.user.id},1))[0];if(old)version(old,b.version);else if(b.version!==0)fail(409,'STALE_VERSION','New preferences use version 0.');
 const data={email_enabled:b.emailEnabled,reminders_enabled:b.remindersEnabled};const r=old?await s.update('u_o_preferences',old.id,data):await s.insert('u_o_preferences',{user_id:s.user.id,...data});await s.audit('O_PREFERENCES_CHANGED',r.id);return r;
}
export async function markRead(s,notificationId,b) {fields(b,[]);const r=await s.get('u_o_notifications',uuid(notificationId));if(r.user_id!==s.user.id)fail(404,'NOT_FOUND','Notification not found.');if(r.read_at)return r;return s.update('u_o_notifications',r.id,{read_at:new Date().toISOString()});}
export async function requestOcr(s,documentId,b,cfg) {
 fields(b,['version']);role(s.user,['ADMIN','ENTRY']);if(!cfg.ocrEnabled)fail(503,'OCR_DISABLED','Enable the local English OCR worker explicitly before requesting OCR.');
 const d=await s.get('documents',uuid(documentId),{lock:true});if(s.user.role!=='ADMIN'&&d.uploaded_by!==s.user.id)fail(404,'NOT_FOUND','Document not found.');version(d,b.version);
 if(d.scan_result!=='CLEAN'||d.status!=='REVIEW_REQUIRED')fail(409,'EVIDENCE_NOT_READY','OCR is available only for clean, unlinked documents awaiting review.');
 if(!['application/pdf','image/png','image/jpeg'].includes(d.mime_type))fail(422,'OCR_TYPE','OCR accepts PDF, PNG and JPEG documents.');
 const imported=await s.rows('u_i_files',{document_id:d.id},100);for(const f of imported)if(await s.count('u_i_rows',{file_id:f.id,status:'IMPORTED'}))fail(409,'ALREADY_IMPORTED','OCR cannot change a document after rows were imported. Preserve the current provenance.');
 if(await s.count('u_o_ocr_runs',{document_id:d.id,status:['QUEUED','PROCESSING']}))fail(409,'OCR_PENDING','OCR is already queued for this document.');
 const run=await s.insert('u_o_ocr_runs',{document_id:d.id,document_version:d.version,input_sha256:d.sha256,status:'QUEUED',previous_extraction:d.extraction,created_by:s.user.id});await s.enqueue('OCR_DOCUMENT',run.id);await s.audit('O_OCR_REQUESTED',d.id,{runId:run.id});return run;
}
