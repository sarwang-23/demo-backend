import { createHmac } from 'node:crypto';
import { uuid, fail, hash, canonical, idempotencyKey } from './core.mjs';
export async function createPool(config) {
    const { Pool, types } = await import('pg');
    // Keep calendar dates and exact NUMERIC values as strings.
    types.setTypeParser(1082, x => x);
    const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.ssl, enableChannelBinding: config.enableChannelBinding === true, max: config.poolMax, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: 'carbonsynq-scale', statement_timeout: 15000, query_timeout: 20000 });
    pool.on('error', err => console.error(JSON.stringify({ event: 'db_pool_error', code: err.code || 'UNKNOWN' })));
    return pool;
}
export function guardClient(client) {
    // A checked-out client has no error listener. Without this, a server-side disconnect
    // (idle_in_transaction_session_timeout, proxy or network reset) emits an unhandled
    // 'error' event and terminates the whole process.
    if (typeof client?.on === 'function')
        client.on('error', err => console.error(JSON.stringify({ event: 'db_client_error', code: err.code || 'UNKNOWN' })));
    return client;
}
export async function tenantTx(pool, tenantId, fn) {
    uuid(tenantId, 'tenantId');
    const client = guardClient(await pool.connect());
    let broken = false;
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '25s'");
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        try {
            await client.query('ROLLBACK');
        }
        catch {
            broken = true;
        }
        throw error;
    }
    finally {
        client.release(broken);
    }
}
export async function assertRuntimeRole(pool, worker = false) {
    const r = (await pool.query(`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
    if (!r || r.rolsuper || r.rolbypassrls || r.name !== (worker ? 'cs_worker' : 'cs_api'))
        throw Error('Runtime must use the dedicated non-owner cs_api/cs_worker role, never the migration owner.');
    const owned = (await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='cs' AND tableowner=current_user LIMIT 1")).rows;
    if (owned.length)
        throw Error('Runtime roles must not own tables.');
}
export async function audit(c, actor, action, entityId, details = {}) {
    await c.query(`INSERT INTO cs.audit_events(tenant_id,actor_id,action,entity_id,details,request_id) VALUES($1,$2,$3,$4,$5,$6)`, [actor.tenant_id, actor.id || null, action, entityId, JSON.stringify(details), actor.requestId || null]);
}
export async function idempotent(c, user, route, key, input, fn) {
    idempotencyKey(key);
    const secret = process.env.REQUEST_HASH_SECRET;
    if (!secret || secret.length < 32)
        throw Error('REQUEST_HASH_SECRET must be at least 32 characters.');
    const digest = createHmac('sha256', secret).update(canonical(input)).digest('hex');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${user.tenant_id}:${user.id}:${route}:${key}`]);
    const existing = (await c.query(`SELECT request_hash,response FROM cs.idempotency_keys WHERE tenant_id=$1 AND actor_id=$2 AND route=$3 AND request_key=$4 AND expires_at>now()`, [user.tenant_id, user.id, route, key])).rows[0];
    if (existing) {
        if (existing.request_hash !== digest)
            fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used with a different request.');
        return existing.response;
    }
    const response = await fn();
    await c.query(`INSERT INTO cs.idempotency_keys(tenant_id,actor_id,route,request_key,request_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours') ON CONFLICT(tenant_id,actor_id,route,request_key) DO UPDATE SET request_hash=EXCLUDED.request_hash,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`, [user.tenant_id, user.id, route, key, digest, JSON.stringify(response)]);
    return response;
}
export async function enqueue(c, tenantId, kind, entityId, delaySeconds = 0, suffix = '') {
    await c.query(`INSERT INTO cs.jobs(tenant_id,kind,entity_id,dedupe_key,available_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 second') ON CONFLICT(tenant_id,dedupe_key) DO NOTHING`, [tenantId, kind, entityId, `${kind}:${entityId}${suffix}`, delaySeconds]);
}
