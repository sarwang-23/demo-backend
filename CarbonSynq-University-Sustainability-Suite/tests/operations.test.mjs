import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,existsSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {openDatabase,seed} from '../lib/db.mjs';
import {acquireRuntimeLock,ensureStopped} from '../lib/runtime.mjs';
function fixture(){
 const dir=mkdtempSync(path.join(tmpdir(),'carbonsynq-operations-'));
 const data=path.join(dir,'data');mkdirSync(path.join(dir,'lib'));
 copyFileSync(new URL('../tools.mjs',import.meta.url),path.join(dir,'tools.mjs'));
 copyFileSync(new URL('../lib/runtime.mjs',import.meta.url),path.join(dir,'lib/runtime.mjs'));
 const db=openDatabase(path.join(data,'demo.sqlite'));seed(db);db.close();
 const run=(...args)=>spawnSync(process.execPath,[path.join(dir,'tools.mjs'),...args],{env:{...process.env,DEMO_DATA_DIR:data},encoding:'utf8',timeout:10000});
 return {dir,data,run,clean:()=>rmSync(dir,{recursive:true,force:true})};
}
test('runtime lock blocks a second live process and backup while running',()=>{
 const f=fixture();let release;
 try{release=acquireRuntimeLock(f.data);assert.throws(()=>ensureStopped(f.data),/already be running/);assert.throws(()=>acquireRuntimeLock(f.data),/already be running/);const result=f.run('backup');assert.equal(result.status,1);assert.match(result.stderr,/already be running/);release();ensureStopped(f.data);assert.equal(existsSync(path.join(f.data,'server.pid')),false);}finally{release?.();f.clean();}
});
test('backup command creates a consistent reopenable SQLite snapshot',()=>{
 const f=fixture();try{const result=f.run('backup');assert.equal(result.status,0,result.stderr);const files=readdirSync(path.join(f.dir,'.backups'));assert.equal(files.length,1);const db=new DatabaseSync(path.join(f.dir,'.backups',files[0]),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,38);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{db.close();}}finally{f.clean();}
});
test('reset refuses missing confirmation and preserves the current database',()=>{
 const f=fixture();try{const before=readFileSync(path.join(f.data,'demo.sqlite'));const result=f.run('reset');assert.equal(result.status,1);assert.match(result.stderr,/explicit confirmation/);assert.deepEqual(readFileSync(path.join(f.data,'demo.sqlite')),before);}finally{f.clean();}
});
test('confirmed reset preserves the old folder rather than deleting it',()=>{
 const f=fixture();try{const result=f.run('reset','--confirm-local-demo-reset');assert.equal(result.status,0,result.stderr);assert.equal(existsSync(f.data),false);const folders=readdirSync(f.dir).filter(n=>n.startsWith('data-before-reset-'));assert.equal(folders.length,1);const db=new DatabaseSync(path.join(f.dir,folders[0],'demo.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,38);}finally{db.close();}}finally{f.clean();}
});
