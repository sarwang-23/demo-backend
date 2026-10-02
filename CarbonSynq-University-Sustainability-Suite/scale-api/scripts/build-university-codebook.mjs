/** Build a complete, reproducible scale-api source reference; no secrets or dependencies. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'docs/university/HLD-AND-FULL-CODE.md');
const extensions = new Set(['.mjs', '.js', '.sql', '.json', '.html', '.css', '.py', '.yaml', '.yml', '.sh', '.http']);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', '__pycache__', 'docs'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile() && (extensions.has(path.extname(entry.name)) || entry.name === 'Dockerfile')) {
      files.push(path.relative(root, absolute).split(path.sep).join('/'));
    }
  }
}
await walk(root);
files.push('docs/openapi.json', 'docs/university/openapi.json', 'docs/university/request-schemas.json');
const selected = [...new Set(files)].sort();
const language = { '.mjs': 'javascript', '.js': 'javascript', '.sql': 'sql', '.json': 'json', '.html': 'html', '.css': 'css', '.py': 'python', '.yaml': 'yaml', '.yml': 'yaml', '.sh': 'bash', '.http': 'http' };
let output = '# CarbonSynq University Suite - HLD and complete integrated scale-api source\n\n';
output += `Version 2.1.0-university-rc.1. ${selected.length} complete source/configuration/API/test files follow the HLD. No code files in this selection are shortened.\n\n`;
output += 'This book covers the integrated PostgreSQL scale-api, including its original core and university extensions. The older SQLite demo and original Neon repository are also preserved in the ZIP; they are not repeated in this book. Credentials, installed dependencies, binary data, generated QA screenshots and historical backup copies are excluded. Real infrastructure acceptance testing remains outstanding.\n\n';
output += await readFile(path.join(root, 'docs/university/HLD.md'), 'utf8');
output += '\n\n---\n\n# Complete source listing\n\n';
for (const relative of selected) {
  const bytes = await readFile(path.join(root, relative));
  const text = bytes.toString('utf8');
  const maxTicks = Math.max(2, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(maxTicks + 1);
  const digest = createHash('sha256').update(bytes).digest('hex');
  output += `\n## scale-api/${relative}\n\nSHA-256: \`${digest}\`\n\n${fence}${language[path.extname(relative)] || 'text'}\n${text}\n${fence}\n`;
}
await writeFile(destination, output, 'utf8');
console.log(JSON.stringify({ files: selected.length, destination, bytes: Buffer.byteLength(output) }));
