import { id } from '../core.mjs';
import { tenantTx } from '../db.mjs';
import { ownedJob } from '../jobs.mjs';
import { OperationsStore } from './store.mjs';
import { seal } from './crypto.mjs';
export function dueReminder(task,today){return task.status==='OPEN'&&task.due_date<today;}
export async function processSweep(pool,job,cfg) {
 return tenantTx(pool,job.tenant_id,async c=>{
  await ownedJob(c,job);await c.query("SET LOCAL TIME ZONE 'UTC'");const store=new OperationsStore(c,{tenant_id:job.tenant_id,id:null,role:'WORKER'});
  if(!await store.activeTenant()){await c.query("UPDATE cs.jobs SET status='QUEUED',attempts=0,available_at=now()+interval '1 hour',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND lease_token=$3",[job.id,job.tenant_id,job.lease_token]);return {suspended:true};}
  // SQL selection dedupes BEFORE the limit so the next sweep can reach later tasks.
  const tasks=(await c.query(`SELECT t.* FROM cs.u_tasks t JOIN cs.users u ON u.tenant_id=t.tenant_id AND u.id=t.assignee_id AND u.active
   LEFT JOIN cs.u_o_preferences p ON p.tenant_id=t.tenant_id AND p.user_id=t.assignee_id
   WHERE t.tenant_id=$1 AND t.status='OPEN' AND t.due_date<CURRENT_DATE AND coalesce(p.reminders_enabled,true)
   AND NOT EXISTS(SELECT 1 FROM cs.u_o_notifications n WHERE n.tenant_id=t.tenant_id AND n.user_id=t.assignee_id AND n.dedupe_key='overdue:'||t.id||':'||CURRENT_DATE)
   ORDER BY t.due_date,t.id LIMIT 500`,[job.tenant_id])).rows;
  const today=(await c.query('SELECT CURRENT_DATE::text AS day')).rows[0].day;
  for(const task of tasks)await store.notify(task.assignee_id,'OVERDUE_TASK',task.id,'A collection task is overdue','Sign in to review your outstanding task. The reminder does not change task status.',`overdue:${task.id}:${today}`);
  const pending=(await c.query(`SELECT n.*,u.email,coalesce(p.email_enabled,false) AS email_enabled FROM cs.u_o_notifications n
    JOIN cs.users u ON u.tenant_id=n.tenant_id AND u.id=n.user_id AND u.active
    LEFT JOIN cs.u_o_preferences p ON p.tenant_id=n.tenant_id AND p.user_id=n.user_id
    WHERE n.tenant_id=$1 AND NOT n.email_queued ORDER BY n.created_at,n.id LIMIT 500 FOR UPDATE OF n SKIP LOCKED`,[job.tenant_id])).rows;
  for(const n of pending){
   if(n.email_enabled&&cfg.mailMode!=='disabled'){
    const rid=id(),message={to:n.email,subject:'CarbonSynq: '+n.title,text:`${n.message}\n\n${cfg.origin}/operations\n\nRecord: ${n.entity_id||'workspace'}\nManage notification preferences in your workspace.`};
    await store.enqueueMail({id:rid,tenant_id:job.tenant_id,user_id:n.user_id,kind:'NOTIFICATION',envelope:seal(message,cfg.encryptionKey,`${job.tenant_id}:${rid}`),dedupe_key:'notification:'+n.id,expires_at:new Date(Date.now()+7*86400000).toISOString()});
   }
   // Disabled/muted messages are deliberately not replayed later as an old email flood.
   await c.query('UPDATE cs.u_o_notifications SET email_queued=true WHERE tenant_id=$1 AND id=$2',[job.tenant_id,n.id]);
  }
  await c.query("UPDATE cs.jobs SET status='QUEUED',attempts=0,available_at=now()+interval '5 minutes',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND lease_token=$3",[job.id,job.tenant_id,job.lease_token]);
  return {overdueCreated:tasks.length,notificationsProcessed:pending.length};
 });
}
