import { id, fail, role, passwordHash, passwordVerify } from '../core.mjs';
import { fields, text, uuid } from '../university/core.mjs';
import { credentialToken, digest, seal, parseCredential } from './crypto.mjs';
export const GENERIC_RESET = Object.freeze({ accepted: true, message: 'When an active matching account exists and delivery is configured, a time-limited recovery message will be sent. No account changes are made by this request.' });
export function normalizeEmail(value) { const email = text(value, 'email', 254).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(422,'INVALID_EMAIL','Enter a valid email.'); return email; }
export function credentialLive(row, tokenHash, now = new Date()) { return !!row && row.token_hash === tokenHash && !row.revoked_at && !row.consumed_at && Date.parse(row.expires_at) > +now; }
async function issue(s, cfg, { purpose, account, email, name, accountRole }, now) {
  await s.revokeCredentials(email);
  const tokenId=id(),raw=credentialToken(s.tenant,tokenId),expires=new Date(+now+(purpose==='RESET'?30*60:24*60*60)*1000).toISOString();
  const row={id:tokenId,tenant_id:s.tenant,purpose,user_id:account?.id||null,email,name:name||null,role:accountRole||null,
    token_hash:digest(raw),password_stamp:account?digest(account.password_hash):null,expires_at:expires,created_by:s.user.id||null};
  await s.credential(row);
  const mailId=id(),action=purpose==='RESET'?'Reset your password':'Accept your staff invitation';
  const link=`${cfg.origin}/account#token=${encodeURIComponent(raw)}`;
  const payload={to:email,subject:`CarbonSynq: ${action}`,text:`${action}\n\n${link}\n\nExpires: ${expires}\nThis link is single use. Do not forward it. Ignore this message if you did not expect it.`,credentialId:tokenId};
  await s.enqueueMail({id:mailId,tenant_id:s.tenant,user_id:account?.id||null,credential_id:tokenId,kind:purpose,envelope:seal(payload,cfg.encryptionKey,`${s.tenant}:${mailId}`),dedupe_key:`credential:${tokenId}`,expires_at:expires});
  await s.audit(purpose==='RESET'?'O_RESET_REQUESTED':'O_STAFF_INVITED',tokenId,{purpose,delivery:'QUEUED',expiresAt:expires});
  return {id:tokenId,expiresAt:expires,delivery:'QUEUED',kind:purpose};
}
export async function requestReset(s,b,cfg,{now=new Date()}={}) {
  fields(b,['tenantId','email']);const email=normalizeEmail(b.email);
  if(cfg.mailMode==='disabled'||!await s.activeTenant())return {...GENERIC_RESET};
  await s.lockKey('credential:'+email);const account=await s.account(email);
  if(account?.active)await issue(s,cfg,{purpose:'RESET',account,email},now);
  return {...GENERIC_RESET};
}
export async function inviteStaff(s,b,cfg,{now=new Date()}={}) {
  role(s.user,['ADMIN']);fields(b,['email','name','role','currentPassword']);
  if(cfg.mailMode==='disabled')fail(503,'DELIVERY_NOT_CONFIGURED','Configure the mail webhook, or development-only mail capture, before issuing staff invitations.');
  if(!['ADMIN','ENTRY','REVIEWER','LEADERSHIP'].includes(b.role))fail(422,'INVALID_ROLE','Choose an allowed staff role.');
  const self=await s.accountById(s.user.id);if(!self?.active||self.role!=='ADMIN'||!await passwordVerify(b.currentPassword,self.password_hash))fail(401,'REAUTH_REQUIRED','Confirm your current administrator password.');
  const email=normalizeEmail(b.email),name=text(b.name,'name',160);await s.lockKey('credential:'+email);
  if(await s.account(email))fail(409,'ACCOUNT_EXISTS','This address already has an account. Use account recovery or access management instead.');
  return issue(s,cfg,{purpose:'INVITE',email,name,accountRole:b.role},now);
}
/** Hashing is intentionally outside the tenant transaction in the HTTP wrapper. */
export async function consumeLink(s,b,encodedPassword,{now=new Date()}={}) {
  fields(b,['token','newPassword','confirmPassword']);
  if(b.newPassword!==b.confirmPassword)fail(422,'PASSWORD_MISMATCH','Both password fields must match.');
  const parsed=parseCredential(b.token);if(!await s.activeTenant())fail(400,'INVALID_LINK','This link is invalid or expired.');if(parsed.tenantId!==s.tenant)fail(400,'INVALID_LINK','This link is invalid or expired.');
  const seen=await s.tokenById(parsed.id);if(!seen)fail(400,'INVALID_LINK','This link is invalid or expired.');
  await s.lockKey('credential:'+seen.email);
  const row=await s.tokenById(parsed.id,true);
  if(!credentialLive(row,parsed.tokenHash,now)||!await s.activeTenant())fail(400,'INVALID_LINK','This link is invalid or expired.');
  let userId;
  if(row.purpose==='RESET') {
    const account=await s.accountById(row.user_id,true);
    if(!account?.active||account.email!==row.email||digest(account.password_hash)!==row.password_stamp)fail(400,'INVALID_LINK','This link is invalid or expired.');
    await s.setAccountPassword(account.id,encodedPassword);userId=account.id;
  } else {
    const issuer=await s.accountById(row.created_by,true);
    if(!issuer?.active||issuer.role!=='ADMIN'||await s.account(row.email))fail(400,'INVALID_LINK','This link is invalid or expired.');
    userId=await s.createInvitedAccount(row,encodedPassword);
  }
  await s.consumeCredential(row.id);await s.revokeCredentials(row.email);
  await s.audit(row.purpose==='RESET'?'O_PASSWORD_RECOVERED':'O_INVITATION_ACCEPTED',userId,{credentialId:row.id,sessionsRevoked:row.purpose==='RESET'});
  return {completed:true,signInRequired:true,sessionsRevoked:row.purpose==='RESET'};
}
export async function preparePassword(b) {
  fields(b,['token','newPassword','confirmPassword']);parseCredential(b.token);
  if(b.newPassword!==b.confirmPassword)fail(422,'PASSWORD_MISMATCH','Both password fields must match.');
  return passwordHash(b.newPassword);
}
export async function revokeInvitation(s,id,b) {role(s.user,['ADMIN']);fields(b,[]);const r=await s.tokenById(uuid(id));if(!r||r.purpose!=='INVITE')fail(404,'NOT_FOUND','Invitation not found.');await s.revokeCredential(r.id);await s.audit('O_INVITATION_REVOKED',r.id);return {revoked:true};}
