import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readEnvText, prepareNeonEnv, checkNeonEnv, renderEnv } from '../../scripts/neon-env-lib.mjs';
import { config } from '../../src/config.mjs';
import { migrate } from '../../scripts/migrate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const template = readFileSync(path.join(root, '.env.neon.example'), 'utf8');
const host = 'ep-synthetic-only.ap-southeast-1.aws.neon.tech';
const password = 'synthetic-owner-password-not-a-real-credential';
const owner = `postgresql://neondb_owner:${password}@${host}/neondb`;
const input = () => ({...readEnvText(template), DATABASE_OWNER_URL: owner});
const keys = ['DB_API_PASSWORD','DB_WORKER_PASSWORD','AWS_SECRET_ACCESS_KEY','METRICS_TOKEN','REQUEST_HASH_SECRET','MAIL_ENCRYPTION_KEY'];

function fixture(text = renderEnv(template, input())) {
  const folder = mkdtempSync(path.join(tmpdir(), 'cs-env-test-'));
  for (const relative of ['scripts/prepare-neon-env.mjs','scripts/check-neon-env.mjs','scripts/neon-env-lib.mjs','src/config.mjs','src/core.mjs','src/operations/crypto.mjs','.env.neon.example']) {
    const target = path.join(folder,relative); mkdirSync(path.dirname(target),{recursive:true}); copyFileSync(path.join(root,relative),target);
  }
  if (text !== null) writeFileSync(path.join(folder,'.env'),text);
  return folder;
}
function run(folder, script='prepare-neon-env.mjs', extraEnv={}) {
  return spawnSync(process.execPath,[path.join(folder,'scripts',script)],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,...extraEnv}});
}

test('template has correct port/origins but fails readiness without rotated credentials',()=>{
  const e=readEnvText(template);assert.equal(e.PORT,'5000');assert.equal(e.PUBLIC_BASE_URL,'http://localhost:5000');assert.match(e.ALLOWED_ORIGINS,/http:\/\/localhost:3000/);
  assert.throws(()=>prepareNeonEnv(e), /replace the placeholder/);
});
test('prepares three distinct direct URL identities and verified TLS',()=>{
  const e=prepareNeonEnv(input());const o=new URL(e.DATABASE_OWNER_URL),a=new URL(e.DATABASE_URL),w=new URL(e.WORKER_DATABASE_URL);
  assert.equal(o.username,'neondb_owner');assert.equal(a.username,'cs_api');assert.equal(w.username,'cs_worker');assert.equal(a.hostname,host);assert.equal(a.port,'5432');
  assert.equal(a.search,'');assert.equal(e.DB_SSL,'true');assert.equal(new Set([o.password,a.password,w.password]).size,3);
});
test('generates fresh unpredictable values locally and does not mutate input',()=>{
  const original=input(),a=prepareNeonEnv(original),b=prepareNeonEnv(original);
  for(const k of keys){assert.match(a[k],/^[0-9a-f]{64}$/);assert.notEqual(a[k],b[k]);assert.equal(original[k],'GENERATE_ON_YOUR_MACHINE');}
});
test('reruns preserve every valid previously prepared secret',()=>{
  const a=prepareNeonEnv(input()),b=prepareNeonEnv(a);assert.deepEqual(b,a);
});
test('a copied pooled Neon URL becomes direct and its TLS options become explicit config',()=>{
  const e=prepareNeonEnv({...input(),DATABASE_OWNER_URL:owner.replace('ep-synthetic-only.','ep-synthetic-only-pooler.')+'?sslmode=require&channel_binding=require'});
  assert.equal(new URL(e.DATABASE_OWNER_URL).hostname,host);assert.equal(new URL(e.DATABASE_URL).hostname,host);assert.equal(new URL(e.DATABASE_OWNER_URL).search,'');assert.equal(e.DB_CHANNEL_BINDING,'true');
});
test('percent-encoded special password characters survive URL normalization',()=>{
  const p="fake-$-@-#-?-/-'-percent%-password";
  const e=prepareNeonEnv({...input(),DATABASE_OWNER_URL:`postgresql://neondb_owner:${encodeURIComponent(p)}@${host}/neondb?sslmode=verify-full`});
  assert.equal(decodeURIComponent(new URL(e.DATABASE_OWNER_URL).password),p);
  const reparsed=readEnvText(renderEnv(template,e));assert.deepEqual(reparsed,e);
});
test('rejects insecure SSL query options',()=>assert.throws(()=>prepareNeonEnv({...input(),DATABASE_OWNER_URL:owner+'?sslmode=disable'}),/unsupported URL option/));
test('rejects hidden arbitrary connection options',()=>assert.throws(()=>prepareNeonEnv({...input(),DATABASE_OWNER_URL:owner+'?options=arbitrary'}),/unsupported URL option/));
test('rejects invalid URLs without including their value in errors',()=>{
  const sensitive='synthetic-private-malformed-value';assert.throws(()=>prepareNeonEnv({...input(),DATABASE_OWNER_URL:sensitive}),e=>!e.message.includes(sensitive)&&e.code==='ENV_SETUP');
});
test('rejects owner URL in another database service',()=>assert.throws(()=>prepareNeonEnv({...input(),DATABASE_OWNER_URL:owner.replace(host,'example.invalid')}),/Neon hostname/));
test('rejects fragments so unencoded password characters cannot silently truncate URL',()=>assert.throws(()=>prepareNeonEnv({...input(),DATABASE_OWNER_URL:owner+'#secret'}),/no fragment/));
test('runtime role cannot act as migration owner',()=>assert.throws(()=>prepareNeonEnv({...input(),DATABASE_OWNER_URL:owner.replace('neondb_owner','cs_api')}),/operator\/migration owner/));
test('rejects nonlocal/production profile instead of overwriting it',()=>assert.throws(()=>prepareNeonEnv({...input(),NODE_ENV:'production'}),/only prepares/));
test('cannot turn off Neon TLS',()=>assert.throws(()=>prepareNeonEnv({...input(),DB_SSL:'false'}),/DB_SSL=true/));
test('explicit binding flag is enabled for API and worker config',()=>{
  const e=prepareNeonEnv(input());assert.equal(config(e).enableChannelBinding,true);assert.equal(config(e,true).enableChannelBinding,true);
});
test('binding config rejects invalid values and plaintext transport',()=>{
  const e=prepareNeonEnv(input());assert.throws(()=>config({...e,DB_CHANNEL_BINDING:'yes'}),/true or false/);assert.throws(()=>config({...e,DB_SSL:'false'}),/DB_SSL=true/);
});
test('existing runtime credentials are kept, not rotated implicitly',()=>{
  const a=prepareNeonEnv(input());a.DB_API_PASSWORD='GENERATE_ON_YOUR_MACHINE';const b=prepareNeonEnv(a);assert.equal(new URL(b.DATABASE_URL).password,b.DB_API_PASSWORD);
});
test('runtime URL and separate password mismatch is rejected',()=>{
  const e=prepareNeonEnv(input());e.DB_API_PASSWORD='another-synthetic-password-that-must-not-be-used';assert.throws(()=>prepareNeonEnv(e),/does not match/);
});
test('runtime URL cannot point to another endpoint',()=>{
  const e=prepareNeonEnv(input());e.DATABASE_URL=e.DATABASE_URL.replace(host,'ep-other.ap-southeast-1.aws.neon.tech');assert.throws(()=>prepareNeonEnv(e),/same Neon endpoint/);
});
test('runtime URL cannot use owner permissions',()=>{
  const e=prepareNeonEnv(input());e.DATABASE_URL=owner;assert.throws(()=>prepareNeonEnv(e),/dedicated role/);
});
test('API and worker password reuse is rejected',()=>{
  const e=input();e.DB_API_PASSWORD='same-synthetic-password-reused-for-test-only';e.DB_WORKER_PASSWORD=e.DB_API_PASSWORD;assert.throws(()=>prepareNeonEnv(e),/distinct passwords/);
});
test('duplicate .env variable names are rejected',()=>assert.throws(()=>readEnvText(template+'\nPORT=6000\n'),/Duplicate/));
test('old API/JWT keys are not silently retained in the new file',()=>assert.throws(()=>readEnvText(template+'\nGEMINI_API_KEY=synthetic-unused-key\n'),/Legacy provider/));
test('multiline and oversized .env input are rejected',()=>{
  assert.throws(()=>readEnvText('X="line1\nline2"'),/single-line/);assert.throws(()=>readEnvText('#'.repeat(65537)),/64 KiB/);
});
test('comments and all configured values survive rendering and read-back',()=>{
  const e=prepareNeonEnv(input()),t=renderEnv(template,e);assert.match(t,/# CarbonSynq:/);assert.deepEqual(readEnvText(t),e);assert.equal(renderEnv(t,e),t);
});
test('readiness returns only redacted status and makes no external verification claim',()=>{
  const e=prepareNeonEnv(input()),r=checkNeonEnv(e),s=JSON.stringify(r);assert.equal(r.databaseContacted,false);assert.equal(r.migrationsRun,false);assert.equal(r.emailSent,false);
  for(const k of keys)assert.ok(!s.includes(e[k]));assert.ok(!s.includes(password));assert.equal(r.port,5000);
});
test('readiness rejects stale public port and missing own UI origin',()=>{
  const e=prepareNeonEnv(input());assert.throws(()=>checkNeonEnv({...e,PUBLIC_BASE_URL:'http://localhost:8080'}),/actual localhost PORT/);assert.throws(()=>checkNeonEnv({...e,ALLOWED_ORIGINS:'http://localhost:3000'}),/ALLOWED_ORIGINS/);
});
test('local compose profile does not claim to configure a custom CA or external storage',()=>{
  const e=prepareNeonEnv(input());assert.throws(()=>checkNeonEnv({...e,DB_CA_FILE:'/tmp/custom.pem'}),/Runtime configuration|custom DB_CA_FILE/);assert.throws(()=>checkNeonEnv({...e,S3_ENDPOINT:'https://storage.example.invalid'}),/local-only/);
});
test('readiness requires prepared direct URLs not raw pooler strings',()=>{
  const e=prepareNeonEnv(input());e.DATABASE_URL=e.DATABASE_URL.replace('ep-synthetic-only.','ep-synthetic-only-pooler.');assert.throws(()=>checkNeonEnv(e),/direct URL/);
});
test('CLI writes private .env, preserves it on rerun and never prints secrets',()=>{
  const f=fixture();try{const a=run(f);assert.equal(a.status,0,a.stderr);const s=readFileSync(path.join(f,'.env'),'utf8'),e=readEnvText(s);assert.equal(checkNeonEnv(e).valid,true);const b=run(f);assert.equal(b.status,0,b.stderr);assert.equal(readFileSync(path.join(f,'.env'),'utf8'),s);
    for(const k of keys)assert.ok(!(a.stdout+a.stderr+b.stdout+b.stderr).includes(e[k]));assert.ok(!a.stdout.includes(password));assert.ok(!existsSync(path.join(f,'.env.prepare.lock')));if(process.platform!=='win32')assert.equal(statSync(path.join(f,'.env')).mode&0o777,0o600);
  }finally{rmSync(f,{recursive:true,force:true});}
});
test('CLI failure leaves invalid input unchanged and returns useful no-secret error',()=>{
  const f=fixture(template);try{const result=run(f);assert.equal(result.status,1);assert.match(result.stderr,/replace the placeholder/);assert.equal(readFileSync(path.join(f,'.env'),'utf8'),template);assert.ok(!result.stderr.includes('ep-patient'));}finally{rmSync(f,{recursive:true,force:true});}
});
test('first-run CLI copies a safe template when .env is absent and then stops for owner input',()=>{
  const f=fixture(null);try{const result=run(f);assert.equal(result.status,1);assert.equal(readFileSync(path.join(f,'.env'),'utf8'),template);}finally{rmSync(f,{recursive:true,force:true});}
});
test('env checker rejects conflicting shell config without printing conflicting values',()=>{
  const f=fixture();try{assert.equal(run(f).status,0);const a=run(f,'check-neon-env.mjs');assert.equal(a.status,0,a.stderr);const b=run(f,'check-neon-env.mjs',{DATABASE_URL:'synthetic-conflicting-shell-secret'});assert.equal(b.status,1);assert.match(b.stderr,/Conflicting/);assert.ok(!b.stderr.includes('synthetic-conflicting-shell-secret'));}finally{rmSync(f,{recursive:true,force:true});}
});
test('a concurrent setup lock is not removed by the losing CLI',()=>{
  const f=fixture();try{mkdirSync(path.join(f,'.env.prepare.lock'));const a=run(f);assert.equal(a.status,1);assert.ok(existsSync(path.join(f,'.env.prepare.lock')));}finally{rmSync(f,{recursive:true,force:true});}
});
test('migration rejects transaction-pooler endpoints before importing database driver',async()=>{
  await assert.rejects(migrate(owner.replace('ep-synthetic-only.','ep-synthetic-only-pooler.'),{apiPassword:'a'.repeat(32),workerPassword:'b'.repeat(32)}),/direct database endpoint/);
});
test('API and worker compose environments exclude the migration-owner URL',()=>{
  const text=readFileSync(path.join(root,'compose.neon.yaml'),'utf8');assert.ok(!/^  database:/m.test(text));
  const api=text.split('\n  api:\n')[1].split('\nvolumes:')[0],worker=text.split('\n  worker:\n')[1].split('\n  api:\n')[0];
  assert.ok(!api.includes('DATABASE_OWNER_URL'));assert.ok(!worker.includes('DATABASE_OWNER_URL'));assert.ok(!text.includes('env_file:'));assert.match(text,/127\.0\.0\.1:\$\{PORT:-5000\}:8080/);
});
