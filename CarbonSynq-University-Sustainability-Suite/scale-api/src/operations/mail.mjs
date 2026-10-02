import { createHmac } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tenantTx, audit } from '../db.mjs';
import { ownedJob, done } from '../jobs.mjs';
import { uuid } from '../core.mjs';
import { unseal, digest } from './crypto.mjs';
/** External provider must honor Idempotency-Key for effective deduplication after uncertain delivery. */
export async function deliverMessage(message,outboxId,cfg,{fetchImpl=fetch,now=new Date()}={}) {
 uuid(outboxId);
 if(!message||typeof message.to!=='string'||typeof message.subject!=='string'||typeof message.text!=='string'||message.text.length>20000||/[\r\n]/.test(message.to+message.subject))throw Object.assign(Error('Invalid message'),{code:'INVALID_MESSAGE'});
 if(cfg.mailMode==='disabled')throw Object.assign(Error('Delivery is not configured'),{code:'MAIL_DISABLED'});
 if(cfg.mailMode==='capture') {
  if(cfg.production)throw Error('Capture is forbidden in production.');
  const folder=path.resolve(cfg.captureDir);await mkdir(folder,{recursive:true,mode:0o700});
  const target=path.join(folder,outboxId+'.json');
  try{await writeFile(target,JSON.stringify({mode:'LOCAL_CAPTURE_NOT_SENT',id:outboxId,capturedAt:now.toISOString(),...message},null,2),{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;}
  return {status:'CAPTURED',deliveryId:outboxId};
 }
 const body=JSON.stringify({id:outboxId,to:message.to,subject:message.subject,text:message.text}),timestamp=String(Math.floor(+now/1000));
 const signature=createHmac('sha256',cfg.webhookSecret).update(timestamp+'.'+body).digest('hex');
 const response=await fetchImpl(cfg.webhookUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','Idempotency-Key':outboxId,'X-CarbonSynq-Timestamp':timestamp,'X-CarbonSynq-Signature':signature},body});
 await response.body?.cancel?.();
 if(!response.ok)throw Object.assign(Error('Mail delivery failed'),{code:'MAIL_PROVIDER_FAILED'});
 return {status:'SENT',deliveryId:outboxId};
}
export async function processMail(pool,job,cfg,transport=deliverMessage) {
 const row=await tenantTx(pool,job.tenant_id,async c=>{
  await ownedJob(c,job);const m=(await c.query('SELECT * FROM cs.u_o_mail WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[job.tenant_id,job.entity_id])).rows[0];
  if(!m)throw Error('Outbox item not found');if(['SENT','CAPTURED','CANCELLED'].includes(m.status)){await done(c,job);return null;}
  const tenant=(await c.query('SELECT status FROM cs.tenants WHERE id=$1',[job.tenant_id])).rows[0];
  let valid=tenant?.status==='ACTIVE'&&(!m.expires_at||Date.parse(m.expires_at)>Date.now());
  if(m.credential_id){const r=(await c.query('SELECT * FROM cs.u_o_credentials WHERE tenant_id=$1 AND id=$2',[job.tenant_id,m.credential_id])).rows[0];valid=valid&&r&&!r.revoked_at&&!r.consumed_at&&Date.parse(r.expires_at)>Date.now();
   if(valid&&r.purpose==='INVITE'){const issuer=(await c.query('SELECT active,role FROM cs.users WHERE tenant_id=$1 AND id=$2',[job.tenant_id,r.created_by])).rows[0];valid=!!issuer?.active&&issuer.role==='ADMIN';}
   if(valid&&r.purpose==='RESET'){const u=(await c.query('SELECT active,password_hash FROM cs.users WHERE tenant_id=$1 AND id=$2',[job.tenant_id,r.user_id])).rows[0];valid=!!u?.active&&digest(u.password_hash)===r.password_stamp;}
  }
  if(m.user_id){const u=(await c.query('SELECT active FROM cs.users WHERE tenant_id=$1 AND id=$2',[job.tenant_id,m.user_id])).rows[0];valid=valid&&!!u?.active;}
  if(!valid){await c.query("UPDATE cs.u_o_mail SET status='CANCELLED',envelope=NULL,error_code='EXPIRED_OR_REVOKED' WHERE tenant_id=$1 AND id=$2",[job.tenant_id,m.id]);await done(c,job);return null;}return m;
 });
 if(!row)return;
 const message=unseal(row.envelope,cfg.encryptionKey,`${job.tenant_id}:${row.id}`),result=await transport(message,row.id,cfg);
 await tenantTx(pool,job.tenant_id,async c=>{await ownedJob(c,job);await c.query('UPDATE cs.u_o_mail SET status=$3,delivery_id=$4,delivered_at=now(),envelope=NULL,error_code=NULL WHERE tenant_id=$1 AND id=$2',[job.tenant_id,row.id,result.status,result.deliveryId]);await audit(c,{tenant_id:job.tenant_id},'O_MAIL_'+result.status,row.id,{kind:row.kind});await done(c,job);});
}
