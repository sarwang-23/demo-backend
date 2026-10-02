import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export async function migrationPlan(directory=new URL('../migrations/',import.meta.url)){
    const files=(await readdir(directory)).filter(f=>/^\d{3}_[A-Za-z0-9_-]+\.sql$/.test(f)).sort();
    const result=[];
    for(const [i,file] of files.entries()){
        const version=Number(file.slice(0,3));
        if(version!==i+1)throw Error('Migration versions must be contiguous from 001.');
        const sql=await readFile(new URL(file,directory),'utf8');
        result.push({version,file,sql,checksum:createHash('sha256').update(sql).digest('hex')});
    }
    if(!result.length)throw Error('No migration files found.');
    return result;
}
export async function migrate(ownerUrl, { apiPassword, workerPassword, ssl = false, enableChannelBinding = false } = {}) {
    if (!ownerUrl) throw Error('DATABASE_OWNER_URL is required.');
    const parsed = new URL(ownerUrl);
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
        if (parsed.searchParams.has(key)) throw Error('Use DB_SSL/DB_CA_FILE instead of database URL SSL parameters.');
    if (!apiPassword || !workerPassword || apiPassword.length < 24 || workerPassword.length < 24)
        throw Error('DB_API_PASSWORD and DB_WORKER_PASSWORD must be at least 24 characters.');
    if (parsed.hostname.split('.')[0].endsWith('-pooler')) throw Error('Migrations use a session advisory lock and require a direct database endpoint, not -pooler.');
    const plan=await migrationPlan();
    const { Client } = await import('pg');
    const client = new Client({ connectionString: ownerUrl, ssl, enableChannelBinding });
    await client.connect();
    const literal = s => "'" + s.replaceAll("'", "''") + "'";
    try {
        await client.query("SELECT pg_advisory_lock(hashtextextended('carbonsynq:migrations',0))");
        const serverVersion=Number((await client.query('SHOW server_version_num')).rows[0].server_version_num);
        if(serverVersion<150000)throw Error('PostgreSQL 15 or newer is required for security-invoker reporting views. Local compose targets PostgreSQL 17.');
        for (const [name, password] of [['cs_api', apiPassword], ['cs_worker', workerPassword]]) {
            const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount;
            if (!exists) await client.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${literal(password)}`);
        }
        const table = (await client.query("SELECT to_regclass('cs.schema_migrations') AS name")).rows[0].name;
        const history=table?(await client.query('SELECT version,checksum FROM cs.schema_migrations ORDER BY version')).rows:[];
        if(history.length>plan.length)throw Error('Database is newer than this package; do not downgrade blindly.');
        for(const h of history)if(!plan.find(p=>p.version===h.version&&p.checksum===h.checksum))throw Error('Migration history mismatch: do not edit applied migrations.');
        const applied=[];
        for(const migration of plan){
            if(history.some(h=>h.version===migration.version))continue;
            await client.query('BEGIN');
            try {
                await client.query(migration.sql);
                await client.query('INSERT INTO cs.schema_migrations(version,checksum) VALUES($1,$2)', [migration.version,migration.checksum]);
                await client.query('COMMIT');
            } catch (e) { await client.query('ROLLBACK'); throw e; }
            applied.push(migration.version);
        }
        return {version:plan.at(-1).version,applied,alreadyApplied:applied.length===0};
    } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended('carbonsynq:migrations',0))").catch(() => {});
        await client.end();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: true, ...(process.env.DB_CA_FILE ? { ca: await readFile(process.env.DB_CA_FILE, 'utf8') } : {}) } : false;
    if (process.env.NODE_ENV === 'production' && !ssl) throw Error('Production migrations require verified database TLS.');
    console.log(JSON.stringify(await migrate(process.env.DATABASE_OWNER_URL, { apiPassword: process.env.DB_API_PASSWORD, workerPassword: process.env.DB_WORKER_PASSWORD, ssl, enableChannelBinding: process.env.DB_CHANNEL_BINDING === 'true' })));
}
