import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ensureStopped} from './lib/runtime.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.resolve(process.env.DEMO_DATA_DIR??path.join(here,'.local-data'));
const file=path.join(dataDir,'demo.sqlite');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
try {
 ensureStopped(dataDir);
 if(!existsSync(file))throw new Error('No local demo database exists yet. Start the demo once before using this command.');
 const check=new DatabaseSync(file,{readOnly:true});
 let isDemo;try{isDemo=check.prepare("SELECT id FROM universities WHERE code='GFU-DEMO'").get();}finally{check.close();}
 if(!isDemo)throw new Error('This is not the recognized local demo database. No files were changed.');
 const command=process.argv[2];
 if(command==='backup') {
  const targetDir=path.join(here,'.backups');mkdirSync(targetDir,{recursive:true,mode:0o700});
  const target=path.join(targetDir,`demo-${stamp}.sqlite`);
  const db=new DatabaseSync(file);try{await backup(db,target);}finally{db.close();}
  console.log(`Backup saved: ${target}\nIt contains original invoices and local account data. Keep it private.`);
 } else if(command==='reset') {
  if(!process.argv.includes('--confirm-local-demo-reset'))throw new Error('Reset needs explicit confirmation. Stop the demo, then run: npm run demo:reset -- --confirm-local-demo-reset\nThe current data folder will be retained as a timestamped backup, not deleted.');
  const target=dataDir+'-before-reset-'+stamp;renameSync(dataDir,target);
  console.log(`Previous data preserved at: ${target}\nStart the demo again to create a fresh sample dataset.`);
 } else throw new Error('Use backup or reset. This tool never connects to your original Neon database.');
} catch(error){console.error(error.message);process.exitCode=1;}
