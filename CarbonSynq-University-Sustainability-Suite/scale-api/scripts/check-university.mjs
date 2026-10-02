import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { migrationPlan } from './migrate.mjs';
import { ROUTES } from '../src/university/router.mjs';
let count=0;
async function walk(url){for(const f of await readdir(url,{withFileTypes:true})){const child=new URL(f.name+(f.isDirectory()?'/':''),url);if(f.isDirectory())await walk(child);else if(/\.(mjs|js)$/.test(f.name)){const r=spawnSync(process.execPath,['--check',fileURLToPath(child)],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);count++;}}}
for(const directory of ['src/','scripts/','tests/','public/','examples/'])await walk(new URL('../'+directory,import.meta.url));
const plan=await migrationPlan();
const spec=JSON.parse(await readFile(new URL('../docs/university/openapi.json',import.meta.url),'utf8'));
for(const r of ROUTES){const path=r.path.replace(/:([A-Za-z]+)/g,'{$1}');if(!spec.paths[path]?.[r.method.toLowerCase()])throw Error('Missing documented route: '+r.method+' '+path);}
console.log(JSON.stringify({syntaxFilesChecked:count,universityOperations:ROUTES.length,migrations:plan.map(({version,checksum})=>({version,checksum})),openApiCovered:true}));
