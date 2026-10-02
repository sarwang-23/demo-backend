/** Explicit test double. Does NOT execute PostgreSQL RLS, transactions, triggers or locks. */
import { MemoryStore, fixture as base } from '../university/memory-store.mjs';
import { id, fail, passwordHash } from '../../src/core.mjs';
import { canReadEvidence } from '../../src/operations/access.mjs';
import { operationsConfig, unseal } from '../../src/operations/crypto.mjs';
export const TEST_PASSWORD='Test-only-Password-12345';
const encoded=await passwordHash(TEST_PASSWORD);
export class OpsMemory extends MemoryStore {
 for(user){return new OpsMemory(this.state,user);}
 async maybe(table,rid,opts={}){const r=await super.maybe(table,rid,opts);if(table==='documents'&&r&&!canReadEvidence(this.user,r,{scope:(this.state.tables.u_o_document_scopes||[]).find(x=>x.document_id===rid),memberships:this.state.tables.u_o_memberships||[],grants:this.state.tables.u_o_document_grants||[]}))fail(404,'NOT_FOUND','Document not found.');return r;}
 async account(email){return structuredClone((this.state.tables.users||[]).find(r=>r.tenant_id===this.tenant&&r.email===email)||null);}
 async accountById(id){return super.maybe('users',id);}
 async activeTenant(){return this.state.tables.tenants.some(t=>t.id===this.tenant&&t.status==='ACTIVE');}
 async tokenById(rid){return super.maybe('u_o_credentials',rid);}
 async credential(row){this.state.tables.u_o_credentials??=[];this.state.tables.u_o_credentials.push({...structuredClone(row),created_at:new Date().toISOString(),revoked_at:null,consumed_at:null});return row;}
 async revokeCredentials(email){for(const r of this.state.tables.u_o_credentials||[])if(r.tenant_id===this.tenant&&r.email===email&&!r.consumed_at&&!r.revoked_at)r.revoked_at=new Date().toISOString();}
 async consumeCredential(rid){const r=this.state.tables.u_o_credentials.find(r=>r.tenant_id===this.tenant&&r.id===rid);r.consumed_at=new Date().toISOString();}
 async revokeCredential(rid){const r=(this.state.tables.u_o_credentials||[]).find(r=>r.tenant_id===this.tenant&&r.id===rid&&!r.consumed_at);if(!r)fail(404,'NOT_FOUND','Invitation not found');r.revoked_at=new Date().toISOString();}
 async createInvitedAccount(row,password_hash){const uid=id();this.state.tables.users.push({id:uid,tenant_id:this.tenant,name:row.name,email:row.email,role:row.role,password_hash,active:true,email_verified_at:new Date().toISOString()});return uid;}
 async setAccountPassword(uid,password_hash){const r=this.state.tables.users.find(r=>r.tenant_id===this.tenant&&r.id===uid);r.password_hash=password_hash;r.email_verified_at=new Date().toISOString();this.state.sessions=this.state.sessions.filter(x=>x.user_id!==uid||x.tenant_id!==this.tenant);}
 async enqueueMail(row){this.state.tables.u_o_mail??=[];if(!this.state.tables.u_o_mail.some(r=>r.tenant_id===this.tenant&&r.dedupe_key===row.dedupe_key)){this.state.tables.u_o_mail.push({...structuredClone(row),status:'PENDING'});await this.enqueue('SEND_MAIL',row.id);}return row.id;}
 async enqueue(kind,entityId){if(!this.state.jobs.some(j=>j.tenant_id===this.tenant&&j.kind===kind&&j.entity_id===entityId))this.state.jobs.push({id:id(),tenant_id:this.tenant,kind,entity_id:entityId,status:'QUEUED'});}
 async transferSource(rid,owner,expected){const r=this.state.tables.u_c_sources.find(r=>r.tenant_id===this.tenant&&r.id===rid);if(!r||r.ownership_version!==expected)fail(409,'STALE_VERSION','Ownership changed');r.owner_id=owner;r.ownership_version++;return structuredClone(r);}
 async notify(userId,kind,entityId,title,message,dedupeKey){if(!(this.state.tables.u_o_notifications||[]).some(r=>r.tenant_id===this.tenant&&r.user_id===userId&&r.dedupe_key===dedupeKey))await this.insert('u_o_notifications',{user_id:userId,kind,entity_id:entityId,title,message,dedupe_key:dedupeKey,read_at:null});}
}
export function fixture(){const f=base();f.state.sessions=[];f.state.jobs=[];for(const u of f.state.tables.users)u.password_hash=encoded;f.document.version=1;f.document.extraction={kind:'INVOICE',pages:[{page:1,text:''}]};Object.assign(f.state.tables.documents[0],f.document);f.s=new OpsMemory(f.state,f.actors.ADMIN);f.cfg=operationsConfig({MAIL_MODE:'capture',MAIL_ENCRYPTION_KEY:'a'.repeat(64),PUBLIC_BASE_URL:'http://localhost:8080',OCR_ENABLED:'true'});return f;}
export function mailedToken(f,index=-1){const m=f.state.tables.u_o_mail.at(index),text=unseal(m.envelope,f.cfg.encryptionKey,`${f.tenant}:${m.id}`).text;return decodeURIComponent(text.match(/#token=([^\s]+)/)[1]);}
