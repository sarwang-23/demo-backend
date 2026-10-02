import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { tenantTx, idempotent, assertRuntimeRole, enqueue } from '../src/db.mjs';
import { claimJob, ownedJob } from '../src/jobs.mjs';
import { scanWithClamd } from '../src/scanner.mjs';
import { readFile } from 'node:fs/promises';
const tenant = '11111111-1111-4111-8111-111111111111';
process.env.REQUEST_HASH_SECRET = 'test-only-'.repeat(5);
function poolFixture(handler = async () => ({ rows: [] })) {
    const calls = [], released = [];
    const client = { query: async (sql, params) => { calls.push({ sql, params }); return handler(sql, params); }, release: broken => released.push(broken) };
    return { pool: { connect: async () => client }, calls, released, client };
}
test('tenant transaction sets local tenant context and uses one connection', async () => { const f = poolFixture(); await tenantTx(f.pool, tenant, async (c) => { assert.equal(c, f.client); await c.query('BUSINESS'); }); assert.equal(f.calls[0].sql, 'BEGIN'); assert.deepEqual(f.calls[1].params, [tenant]); assert.equal(f.calls.at(-1).sql, 'COMMIT'); assert.deepEqual(f.released, [false]); });
test('transaction errors roll back and release the connection', async () => { const f = poolFixture(); await assert.rejects(tenantTx(f.pool, tenant, () => { throw Error('business failure'); })); assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.deepEqual(f.released, [false]); });
test('a broken rollback destroys rather than recycles the connection', async () => { const f = poolFixture(async (sql) => { if (sql === 'ROLLBACK')
    throw Error('lost socket'); return { rows: [] }; }); await assert.rejects(tenantTx(f.pool, tenant, () => { throw Error('failure'); })); assert.deepEqual(f.released, [true]); });
test('an uncertain COMMIT is not automatically replayed', async () => { let invocations = 0; const f = poolFixture(async (sql) => { if (sql === 'COMMIT')
    throw Error('socket loss'); return { rows: [] }; }); await assert.rejects(tenantTx(f.pool, tenant, () => { invocations++; })); assert.equal(invocations, 1); });
test('runtime refuses superuser database credentials', async () => assert.rejects(assertRuntimeRole({ query: async () => ({ rows: [{ name: 'cs_api', rolsuper: true, rolbypassrls: false }] }) }), /non-owner/));
test('runtime refuses table-owning application role', async () => { let n = 0; await assert.rejects(assertRuntimeRole({ query: async () => ({ rows: ++n === 1 ? [{ name: 'cs_api', rolsuper: false, rolbypassrls: false }] : [{ exists: 1 }] }) }), /own tables/); });
test('idempotency returns stored response instead of running a second mutation', async () => {
    const user = { id: tenant, tenant_id: tenant };
    let stored, executions = 0;
    const c = { query: async (sql, p) => { if (sql.startsWith('SELECT request_hash'))
            return { rows: stored ? [stored] : [] }; if (sql.startsWith('INSERT INTO cs.idempotency_keys'))
            stored = { request_hash: p[4], response: JSON.parse(p[5]) }; return { rows: [] }; } };
    const first = await idempotent(c, user, 'create', 'test-key-0001', { b: 2, a: 1 }, async () => { executions++; return { id: tenant }; });
    assert.deepEqual(await idempotent(c, user, 'create', 'test-key-0001', { a: 1, b: 2 }, () => { throw Error('repeat'); }), first);
    assert.equal(executions, 1);
    await assert.rejects(idempotent(c, user, 'create', 'test-key-0001', { a: 2 }, () => { }), e => e.code === 'IDEMPOTENCY_CONFLICT');
});
test('enqueue uses a unique dedupe key and delayed durable availability', async () => { const f = poolFixture(); await enqueue(f.client, tenant, 'RECONCILE_UPLOAD', tenant, 300); const call = f.calls[0]; assert(call.sql.includes('ON CONFLICT')); assert.equal(call.params[4], 300); });
test('claim SQL uses skip-locked row locking, an attempt cap and a fresh lease token', async () => { const calls = []; await claimJob({ query: async (sql, p) => { calls.push({ sql, p }); return { rows: [] }; } }, 180); assert(calls[1].sql.includes('FOR UPDATE SKIP LOCKED')); assert(calls[1].sql.includes('attempts<max_attempts')); assert.equal(calls[1].p[1], 180); assert.match(calls[1].p[0], /^[a-f0-9-]{36}$/); });
test('stale worker cannot obtain a finalization fence', async () => assert.rejects(ownedJob({ query: async () => ({ rows: [] }) }, { id: tenant, tenant_id: tenant, lease_token: tenant }), e => e.code === 'LEASE_LOST'));
async function clamFixture(result, fn) { let received = Buffer.alloc(0), done = false; const server = net.createServer(socket => { let data = Buffer.alloc(0), header = false; socket.on('data', chunk => { data = Buffer.concat([data, chunk]); if (!header) {
    const n = data.indexOf(0);
    if (n < 0)
        return;
    assert.equal(data.subarray(0, n).toString(), 'zINSTREAM');
    header = true;
    data = data.subarray(n + 1);
} while (data.length >= 4) {
    const n = data.readUInt32BE(0);
    if (data.length < 4 + n)
        return;
    data = data.subarray(4);
    if (n === 0) {
        done = true;
        socket.end(result + '\0');
        return;
    }
    received = Buffer.concat([received, data.subarray(0, n)]);
    data = data.subarray(n);
} }); }); await new Promise(r => server.listen(0, '127.0.0.1', r)); try {
    await fn({ clamHost: '127.0.0.1', clamPort: server.address().port, scanTimeoutMs: 2000 }, () => ({ received, done }));
}
finally {
    await new Promise(r => server.close(r));
} }
test('ClamD client sends correct bounded INSTREAM frames', () => clamFixture('stream: OK', async (cfg, state) => { const bytes = Buffer.alloc(140000, 65); const r = await scanWithClamd(bytes, cfg); assert.equal(r.status, 'CLEAN'); assert(state().done); assert.deepEqual(state().received, bytes); }));
test('ClamD FOUND verdict prevents clean acceptance', () => clamFixture('stream: Test-Signature FOUND', async (cfg) => assert.equal((await scanWithClamd(Buffer.from('test'), cfg)).status, 'INFECTED')));
test('scanner errors fail closed rather than claiming CLEAN', () => clamFixture('INSTREAM size limit exceeded. ERROR', async (cfg) => assert.rejects(scanWithClamd(Buffer.from('test'), cfg), /SCAN_UNAVAILABLE/)));
test('connection refusal fails scanning', async () => { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); await assert.rejects(scanWithClamd(Buffer.from('test'), { clamHost: '127.0.0.1', clamPort: port, scanTimeoutMs: 1000 })); });
test('migration structurally includes RLS, composite FKs and immutable ledgers (not a database execution test)', async () => { const sql = await readFile(new URL('../migrations/001_core.sql', import.meta.url), 'utf8'); assert(sql.includes('FORCE ROW LEVEL SECURITY')); assert(sql.includes('FOREIGN KEY(tenant_id,campus_id,building_id)')); assert(sql.includes('calculation_immutable')); assert(sql.includes('UNIQUE(tenant_id,activity_id)')); assert(!sql.includes('BYPASSRLS;')); });
