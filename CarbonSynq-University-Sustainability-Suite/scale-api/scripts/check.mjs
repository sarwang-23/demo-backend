import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
let checked = 0;
for (const dir of ['src', 'scripts', 'tests', 'public'])
    for (const f of await readdir(new URL(dir + '/', root))) {
        if (!f.endsWith('.mjs') && !f.endsWith('.js'))
            continue;
        const r = spawnSync(process.execPath, ['--check', path.join(fileURLToPath(root), dir, f)], { encoding: 'utf8' });
        if (r.status !== 0) {
            console.error(r.stderr);
            process.exit(1);
        }
        checked++;
    }
const api = JSON.parse(await readFile(new URL('docs/openapi.json', root), 'utf8'));
if (api.openapi !== '3.1.0' || !api.paths['/api/v2/activities'])
    throw Error('OpenAPI contract incomplete.');
console.log(JSON.stringify({ syntaxFilesChecked: checked, openApiPaths: Object.keys(api.paths).length }));
