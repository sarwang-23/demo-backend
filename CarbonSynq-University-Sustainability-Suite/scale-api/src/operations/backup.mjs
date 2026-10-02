/** Operator-only backup helpers. Never mounted as an API; no automatic destructive restore. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir,writeFile,readFile,stat,lstat,realpath } from 'node:fs/promises';
import path from 'node:path';
import { hash } from '../core.mjs';
export async function fileHash(filename){const h=createHash('sha256');for await(const chunk of createReadStream(filename))h.update(chunk);return h.digest('hex');}
export async function saveBackupObject(directory,storage,row,index){
 if(!row.object_version||!row.object_key||!Number.isSafeInteger(Number(row.size))||Number(row.size)<0||Number(row.size)>32*1024*1024||!/^[a-f0-9]{64}$/.test(row.sha256||''))throw Error('Backup object metadata invalid.');
 if(!Number.isSafeInteger(index)||index<0)throw Error('Invalid object sequence.');
 const bytes=await storage.get(row.object_key,row.object_version,Number(row.size));if(bytes.length!==Number(row.size)||hash(bytes)!==row.sha256)throw Error('Backup source object failed checksum/length verification.');
 const relative=`objects/${String(index).padStart(8,'0')}.bin`;await mkdir(path.join(directory,'objects'),{recursive:true,mode:0o700});await writeFile(path.join(directory,relative),bytes,{flag:'wx',mode:0o600});
 return {kind:row.kind,tenantId:row.tenant_id,recordId:row.id,objectKey:row.object_key,versionId:row.object_version,size:bytes.length,sha256:row.sha256,file:relative};
}
export async function verifyBundle(directory){
 const root=await realpath(directory),manifestPath=path.join(root,'manifest.json');if((await lstat(manifestPath)).isSymbolicLink())throw Error('Manifest symlinks are not allowed.');if((await stat(manifestPath)).size>32*1024*1024)throw Error('Manifest exceeds safe bounds.');
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));if(manifest.version!==1||manifest.complete!==true||!Array.isArray(manifest.objects)||manifest.objects.length>50000)throw Error('Incomplete or unsupported backup manifest.');
 const entries=[manifest.database,...manifest.objects],seen=new Set();let bytes=0;
 for(const e of entries){if(!e||typeof e.file!=='string'||!/^(database\.dump|objects\/[0-9]{8}\.bin)$/.test(e.file)||seen.has(e.file))throw Error('Invalid/duplicate backup path.');seen.add(e.file);const p=path.join(root,e.file),info=await lstat(p),actual=await realpath(p);if(info.isSymbolicLink()||!info.isFile()||!actual.startsWith(root+path.sep))throw Error('Backup paths must be regular files inside the bundle.');if(!Number.isSafeInteger(e.size)||e.size<0||info.size!==e.size||!/^[a-f0-9]{64}$/.test(e.sha256)||await fileHash(p)!==e.sha256)throw Error('Backup file checksum/length mismatch: '+e.file);bytes+=info.size;}
 return {verified:true,databaseAndObjects:true,objects:manifest.objects.length,bytes,restoreExecuted:false,encryptedByApplication:false,warning:'Integrity verification is not a restore drill. Restore the database and exact referenced object versions in an isolated environment before relying on this backup.'};
}
