import { UniversityStore } from '../university/store.mjs';
import { id, uuid, fail } from '../core.mjs';
import { enqueue } from '../db.mjs';
/** Credential/outbox secrets have explicit methods, never generic resource endpoints. */
export class OperationsStore extends UniversityStore {
  async account(email) { return (await this.client.query('SELECT * FROM cs.users WHERE tenant_id=$1 AND email=$2', [this.tenant, email])).rows[0] || null; }
  async accountById(id, lock = false) { return (await this.client.query(`SELECT * FROM cs.users WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [this.tenant, uuid(id)])).rows[0] || null; }
  async activeTenant() { return (await this.client.query('SELECT status FROM cs.tenants WHERE id=$1 FOR SHARE', [this.tenant])).rows[0]?.status === 'ACTIVE'; }
  async tokenById(id, lock = false) { return (await this.client.query(`SELECT * FROM cs.u_o_credentials WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [this.tenant, uuid(id)])).rows[0] || null; }
  async credential(row) {
    const keys = ['id','tenant_id','purpose','user_id','email','name','role','token_hash','password_stamp','password_version','expires_at','created_by'];
    await this.client.query(`INSERT INTO cs.u_o_credentials(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`, keys.map(k => row[k] ?? null)); return row;
  }
  async revokeCredentials(email) { await this.client.query('UPDATE cs.u_o_credentials SET revoked_at=now() WHERE tenant_id=$1 AND email=$2 AND consumed_at IS NULL AND revoked_at IS NULL', [this.tenant, email]); }
  async consumeCredential(id) { await this.client.query('UPDATE cs.u_o_credentials SET consumed_at=now() WHERE tenant_id=$1 AND id=$2', [this.tenant, id]); }
  async revokeCredential(id) { const r = await this.client.query('UPDATE cs.u_o_credentials SET revoked_at=now() WHERE tenant_id=$1 AND id=$2 AND consumed_at IS NULL RETURNING id', [this.tenant, uuid(id)]); if (!r.rows.length) fail(404, 'NOT_FOUND', 'Active invitation not found.'); }
  async createInvitedAccount(row, passwordHash) { const userId = id(); await this.client.query('INSERT INTO cs.users(id,tenant_id,name,email,role,password_hash,email_verified_at) VALUES($1,$2,$3,$4,$5,$6,now())', [userId,this.tenant,row.name,row.email,row.role,passwordHash]); return userId; }
  async setAccountPassword(userId, passwordHash) { await this.client.query('UPDATE cs.users SET password_hash=$3,password_version=password_version+1,email_verified_at=coalesce(email_verified_at,now()) WHERE tenant_id=$1 AND id=$2', [this.tenant,userId,passwordHash]); await this.client.query('DELETE FROM cs.sessions WHERE tenant_id=$1 AND user_id=$2', [this.tenant,userId]); }
  async enqueueMail(row) {
    const keys = ['id','tenant_id','user_id','credential_id','kind','envelope','dedupe_key','expires_at'];
    const r=await this.client.query(`INSERT INTO cs.u_o_mail(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(tenant_id,dedupe_key) DO NOTHING RETURNING id`, keys.map(k=>row[k]??null));
    if(r.rows.length) await enqueue(this.client,this.tenant,'SEND_MAIL',row.id); return row.id;
  }
  async enqueue(kind, entityId) { await enqueue(this.client, this.tenant, kind, entityId); }
  async transferSource(id, newOwner, expectedVersion) {
    const r=await this.client.query('UPDATE cs.u_c_sources SET owner_id=$3,ownership_version=ownership_version+1 WHERE tenant_id=$1 AND id=$2 AND ownership_version=$4 RETURNING *',[this.tenant,id,newOwner,expectedVersion]);
    if(!r.rows.length) fail(409,'STALE_VERSION','Source ownership changed. Reload and retry.');return r.rows[0];
  }
  async notify(userId,kind,entityId,title,message,dedupeKey) {
    await this.client.query('INSERT INTO cs.u_o_notifications(tenant_id,user_id,kind,entity_id,title,message,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,user_id,dedupe_key) DO NOTHING',[this.tenant,userId,kind,entityId,title,message,dedupeKey]);
  }
}
