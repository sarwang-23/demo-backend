/** Development only. Never expose captured credential messages over an HTTP API. */
import {readdir,readFile,lstat} from 'node:fs/promises';import {resolve,join} from 'node:path';
if(process.env.NODE_ENV==='production')throw Error('Local capture is forbidden in production.');
const root=resolve(process.env.MAIL_CAPTURE_DIR||'.private-mail'),name=process.argv[2];
if(!name){const files=(await readdir(root)).filter(x=>/^[0-9a-f-]{36}\.json$/.test(x));console.log('LOCAL CAPTURE ONLY - NO EMAIL SENT. Credential links are sensitive.\n'+files.join('\n'));}
else {if(!/^[0-9a-f-]{36}\.json$/.test(name))throw Error('Pass one capture filename from the list.');const p=join(root,name),s=await lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.size>65536)throw Error('Invalid capture file.');console.log(await readFile(p,'utf8'));}
