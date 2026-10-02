import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http.mjs';
import { AppError } from '../src/core.mjs';
const tenant = '11111111-1111-4111-8111-111111111111';
const cfg = { production: false, origins: ['http://localhost:8080'], metricsToken: 'secret', maxInflight: 64, maxUploads: 2, maxUploadBytes: 100, trustProxy: false };
async function fixture(fn, overrides = {}, config = {}) {
    const services = { authenticate: async (h) => { if (h !== 'Bearer test')
            throw new AppError(401, 'UNAUTHENTICATED', 'Sign in'); return { id: tenant, tenant_id: tenant, role: 'ADMIN' }; }, limit: async () => { }, publicUser: u => u, readiness: async () => ({ ready: true }), metadata: async () => ({ name: 'Tenant A' }), login: async (b) => ({ email: b.email }), createActivity: async (u, b, k) => ({ body: b, key: k }), uploadLimit: async () => { }, upload: async (u, n, m, b, k) => ({ name: n, size: b.length, key: k }), ...overrides };
    const app = createApp({ ...cfg, ...config }, services, { log: () => { } });
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    try {
        await fn(base, app);
    }
    finally {
        await new Promise(r => app.server.close(r));
    }
}
const auth = { Authorization: 'Bearer test' };
test('liveness endpoint works without a session', () => fixture(async (base) => { const r = await fetch(base + '/healthz'); assert.equal(r.status, 200); assert.equal((await r.json()).data.service, 'carbonsynq-scale-api'); }));
test('business routes require authentication', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/meta')).status, 401)));
test('business response contains request ID and security headers', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { headers: auth }); assert.equal(r.status, 200); assert(r.headers.get('x-request-id')); assert(r.headers.get('content-security-policy').includes("object-src 'none'")); assert.equal((await r.json()).data.name, 'Tenant A'); }));
test('untrusted browser origins rejected', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/meta', { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403)));
test('allowed origin receives exact CORS header', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { headers: { ...auth, Origin: 'http://localhost:8080' } }); assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080'); }));
test('preflight supports required idempotency header', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080' } }); assert.equal(r.status, 204); assert(r.headers.get('access-control-allow-headers').includes('Idempotency-Key')); }));
test('metrics require a separate credential', () => fixture(async (base) => { assert.equal((await fetch(base + '/metrics')).status, 401); const r = await fetch(base + '/metrics', { headers: { Authorization: 'Bearer secret' } }); assert.equal(r.status, 200); assert((await r.text()).includes('carbonsynq_http')); }));
test('JSON content type is enforced', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/activities', { method: 'POST', headers: auth, body: '{}' })).status, 415)));
test('malformed JSON produces 400, not a stack trace', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' }); assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'INVALID_JSON'); }));
test('JSON array body rejected', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '[]' })).status, 422)));
test('JSON body has a strict 64 KiB limit', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70000) }) })).status, 413)));
test('create routes forward the idempotency key', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'test-key-0001' }, body: '{}' }); assert.equal(r.status, 201); assert.equal((await r.json()).data.key, 'test-key-0001'); }));
test('tenant IDs in query cannot redirect authorization', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/meta?tenantId=' + tenant, { headers: auth })).status, 422)));
test('raw invoice upload is bounded and URL-decodes the filename', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/documents/upload', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain', 'X-Filename': 'Invoice%201.txt', 'Idempotency-Key': 'test-key-0001' }, body: 'quantity: 1 kWh' }); assert.equal(r.status, 202); assert.equal((await r.json()).data.name, 'Invoice 1.txt'); }));
test('invoice size rejection happens before storage', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/documents/upload', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain', 'X-Filename': 'invoice.txt' }, body: 'a'.repeat(101) })).status, 413), { upload: async () => { throw Error('must not run'); } }));
test('readiness returns 503 when a dependency is not ready', () => fixture(async (base) => assert.equal((await fetch(base + '/readyz')).status, 503), { readiness: async () => ({ ready: false }) }));
test('internal service errors are sanitized', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { headers: auth }); assert.equal(r.status, 500); assert(!(await r.text()).includes('PASSWORD')); }, { metadata: async () => { throw Error('PASSWORD=secret'); } }));
test('draining rejects new traffic safely', () => fixture(async (base, app) => { app.drain(); assert.equal((await fetch(base + '/healthz')).status, 503); }));
test('production transport advertises HSTS', () => fixture(async (base) => assert((await fetch(base + '/healthz')).headers.get('strict-transport-security')), {}, { production: true }));
