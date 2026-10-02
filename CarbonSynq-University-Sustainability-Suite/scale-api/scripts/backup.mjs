/** Operator-only PostgreSQL schema backup. Requires pg_dump on PATH and a separately
 * supplied BACKUP_DATABASE_URL whose role can see ALL tenant rows (RLS included).
 * This is not a backup of S3 evidence; preserve pinned object versions separately.
 */
import { spawn } from 'node:child_process';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
const raw = process.env.BACKUP_DATABASE_URL;
if (!raw)
    throw Error('Set a dedicated BACKUP_DATABASE_URL. Never use the API role for cross-tenant backup.');
const u = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(u.protocol))
    throw Error('PostgreSQL URL required.');
for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    if (u.searchParams.has(key))
        throw Error('Configure backup TLS with DB_SSL / DB_CA_FILE, not URL parameters.');
if (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'true')
    throw Error('Production backups require verified TLS.');
const directory = resolve(process.env.BACKUP_DIRECTORY || 'backups');
await mkdir(directory, { recursive: true, mode: 0o700 });
const output = resolve(directory, 'carbonsynq-cs-' + new Date().toISOString().replaceAll(':', '-') + '.dump');
const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: process.env.DB_SSL === 'true' ? 'verify-full' : 'disable', ...(process.env.DB_CA_FILE ? { PGSSLROOTCERT: process.env.DB_CA_FILE } : {}) };
const child = spawn('pg_dump', ['--format=custom', '--schema=cs', '--no-owner', '--no-acl', '--file', output], { env, stdio: ['ignore', 'ignore', 'inherit'] });
const code = await new Promise((ok, fail) => { child.on('error', fail); child.on('exit', ok); });
if (code !== 0)
    throw Error('pg_dump failed. Treat any partial output as invalid; no successful backup is claimed.');
await chmod(output, 0o600);
console.log(JSON.stringify({ databaseBackup: output, includesObjectBytes: false, encryptedByApplication: false, restoreTested: false, note: 'Protect with encryption and test restoration with matching S3 object versions. Grants/roles require separate recreation.' }));
