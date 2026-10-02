import {mkdirSync,existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
export function ensureStopped(dataDir) {
 const pidFile=path.join(dataDir,'server.pid');
 if(!existsSync(pidFile))return;
 const pid=Number(readFileSync(pidFile,'utf8'));
 if(Number.isInteger(pid)&&pid>0){
  try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH'){unlinkSync(pidFile);return;}throw error;}
  throw new Error(`The demo may already be running (PID ${pid}). Stop it with Ctrl+C before starting another copy, backing up or resetting.`);
 }
 throw new Error('Invalid server.pid file. Check that the demo is stopped before removing this file.');
}
export function acquireRuntimeLock(dataDir) {
 mkdirSync(dataDir,{recursive:true,mode:0o700});ensureStopped(dataDir);
 const filename=path.join(dataDir,'server.pid');writeFileSync(filename,String(process.pid),{flag:'wx',mode:0o600});
 return ()=>{try{if(readFileSync(filename,'utf8')===String(process.pid))unlinkSync(filename);}catch{}};
}
