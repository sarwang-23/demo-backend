/** Cross-tenant OPERATOR command. Compatible pg_dump and dedicated backup credentials required.
 * Reads exact object versions referenced by the SAME exported PostgreSQL snapshot as pg_dump.
 * Does not mutate the source DB/storage and never claims a successful restore.
 */
import {spawn} from 'node:child_process';import {mkdir,chmod,writeFile,stat} from 'node:fs/promises';import {resolve,join} from 'node:path';
import {createPool} from '../src/db.mjs';import {config} from '../src/config.mjs';import {createStorage} from '../src/storage.mjs';import {saveBackupObject,fileHash,verifyBundle} from '../src/operations/backup.mjs';
if(process.env.BACKUP_CONFIRM!=='all-tenants-readonly')throw Error('Set BACKUP_CONFIRM=all-tenants-readonly only for an authorized cross-tenant backup.');
if(!process.env.BACKUP_DATABASE_URL)throw Error('BACKUP_DATABASE_URL is required. Never reuse the API role.');
const cfg=config({...process.env,WORKER_DATABASE_URL:process.env.BACKUP_DATABASE_URL},true),pool=await createPool(cfg),storage=await createStorage(cfg),c=await pool.connect();
const dir=resolve(process.env.BACKUP_DIRECTORY||'private-backups','carbonsynq-'+new Date().toISOString().replaceAll(':','-')+'.backup-bundle');
await mkdir(dir,{recursive:false,mode:0o700}).catch(async e=>{if(e.code!=='ENOENT')throw e;await mkdir(resolve(dir,'..'),{recursive:true,mode:0o700});await mkdir(dir,{mode:0o700});});
let committed=false;
try{
 const actor=(await c.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];if(!actor?.rolsuper&&!actor?.rolbypassrls)throw Error('Backup role must explicitly see all forced-RLS rows; refusing a potentially incomplete dump.');await storage.check();
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL idle_in_transaction_session_timeout='20min'");
 const snapshot=(await c.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
 const server=(await c.query('SHOW server_version')).rows[0].server_version;
 const objects=(await c.query(`SELECT 'DOCUMENT' AS kind,id,tenant_id,object_key,object_version,file_size::text AS size,sha256 FROM cs.documents WHERE object_version IS NOT NULL
 UNION ALL SELECT 'INVENTORY_EXPORT',id,tenant_id,object_key,object_version,byte_count::text,sha256 FROM cs.u_o_exports WHERE object_version IS NOT NULL ORDER BY kind,tenant_id,id LIMIT 50001`)).rows;
 if(objects.length>50000)throw Error('Backup is bounded to 50,000 referenced object versions.');const expected=objects.reduce((n,o)=>n+Number(o.size),0),max=Number(process.env.BACKUP_MAX_BYTES||10*1024**3);if(!Number.isSafeInteger(max)||max<1||expected>max)throw Error('Object bytes exceed BACKUP_MAX_BYTES; partition with a reviewed operator plan.');
  const u=new URL(process.env.BACKUP_DATABASE_URL),env={PATH:process.env.PATH,PGHOST:u.hostname,PGPORT:u.port||'5432',PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:cfg.ssl?'verify-full':'disable',...(process.env.DB_CA_FILE?{PGSSLROOTCERT:process.env.DB_CA_FILE}:{})};
  const output=join(dir,'database.dump'),child=spawn(process.env.PG_DUMP_BIN||'pg_dump',['--format=custom','--schema=cs','--no-owner','--no-acl','--snapshot',snapshot,'--file',output],{shell:false,env,stdio:['ignore','ignore','pipe']});let diagnosticBytes=0,diagnostic='';
  // Bounded capture: keep the tail so the operator sees WHY pg_dump failed instead of a bare exit code.
  child.stderr.on('data',b=>{diagnosticBytes+=b.length;diagnostic=(diagnostic+b.toString()).slice(-4096);if(diagnosticBytes>65536)child.kill('SIGKILL');});const timer=setTimeout(()=>child.kill('SIGKILL'),10*60*1000);
  const exit=await new Promise((ok,no)=>{child.on('error',no);child.on('exit',ok);}).finally(()=>clearTimeout(timer));if(exit!==0)throw Error('pg_dump failed or timed out; this directory is incomplete, not a usable backup. pg_dump said: '+(diagnostic.trim()||'(no diagnostics captured)'));await chmod(output,0o600);
 // The dump and object-reference list now describe the same snapshot. Exact S3
 // versions are immutable; release the DB snapshot before slower object copying.
 await c.query('COMMIT');committed=true;
 const manifest={version:1,complete:false,startedAt:new Date().toISOString(),serverVersion:server,snapshot,sourceBucket:cfg.bucket,database:{file:'database.dump',size:(await stat(output)).size,sha256:await fileHash(output)},objects:[],notes:['Contains sensitive cross-tenant data, hashes and original version identifiers. Encrypt/protect externally.','Original files may include quarantined bytes: never render or execute backup .bin objects.','A new object store cannot generally accept the original VersionId. Use provider-native version-preserving restore, or a separately reviewed migration that remaps ALL version references, including immutable snapshots. This tool does not perform that migration.','Roles and privileges must be recreated from reviewed migrations because pg_dump uses --no-acl.','Only DB-referenced versions are captured; orphan/transient object versions and infrastructure secrets are outside this bundle.']};
 for(const [i,row]of objects.entries())manifest.objects.push(await saveBackupObject(dir,storage,row,i));manifest.complete=true;manifest.completedAt=new Date().toISOString();await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({directory:dir,...await verifyBundle(dir)},null,2));
}finally{if(!committed)await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end();storage.close();}
