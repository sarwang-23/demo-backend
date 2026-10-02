/** Real PostgreSQL integration suite; object storage and antivirus are controlled fixtures.
 * Requires an EMPTY disposable database whose name ends in _test. Does not delete data.
 * Not run by `npm test`: absence of infrastructure fails explicitly rather than passing a skip.
 */
import assert from 'node:assert/strict';
import { migrate } from '../scripts/migrate.mjs';
import { id, passwordHash, hash } from '../src/core.mjs';
import { createPool, tenantTx, assertRuntimeRole } from '../src/db.mjs';
import { login, authenticate } from '../src/auth.mjs';
import { createResource, approveFactor, setPeriod, updateUser } from '../src/management.mjs';
import { createActivity, getActivity, transition, confirmInvoice } from '../src/activities.mjs';
import { upload, download, getDocument } from '../src/documents.mjs';
import { claimJob, processCalculation, processInvoice, ownedJob, reconcileUpload } from '../src/jobs.mjs';
import { dashboard } from '../src/reporting.mjs';
import { createApp } from '../src/http.mjs';
import { services } from '../src/services.mjs';
const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!ownerUrl || !new URL(ownerUrl).pathname.endsWith('_test'))
    throw Error('Set TEST_DATABASE_ADMIN_URL to an EMPTY disposable PostgreSQL database ending in _test. No integration test was executed.');
const apiPass = process.env.TEST_API_PASSWORD || 'only-test-api-password-32-characters';
const workerPass = process.env.TEST_WORKER_PASSWORD || 'only-test-worker-password-32-characters';
process.env.REQUEST_HASH_SECRET = 'integration-test-HMAC-secret-not-for-production';
await migrate(ownerUrl, { apiPassword: apiPass, workerPassword: workerPass });
const { Client } = await import('pg');
const owner = new Client({ connectionString: ownerUrl });
await owner.connect();
const appURL = role => { const u = new URL(ownerUrl); u.username = role; u.password = role === 'cs_api' ? apiPass : workerPass; return u.href; };
const api = await createPool({ databaseUrl: appURL('cs_api'), ssl: false, poolMax: 10 });
const worker = await createPool({ databaseUrl: appURL('cs_worker'), ssl: false, poolMax: 5 });
let assertions = 0;
const tested = async (name, fn) => { await fn(); assertions++; console.log('PASS ' + name); };
const cfg = { production: false, origins: ['http://localhost:8080'], metricsToken: 'integration-metrics-token'.repeat(2), maxInflight: 64, maxUploads: 4, maxUploadBytes: 10485760, sessionHours: 8, trustProxy: false };
const objects = new Map();
const storage = {
    async check() { return true; },
    async put(key, bytes, mime) { const versionId = id(); objects.set(key, { bytes: Buffer.from(bytes), versionId, mime }); return { versionId }; },
    async get(key, version) { const o = objects.get(key); assert.equal(o.versionId, version); return o.bytes; },
    async head(key) { const o = objects.get(key); if (!o)
        throw Object.assign(Error('absent'), { name: 'NotFound' }); return { versionId: o.versionId, size: o.bytes.length, sha256: hash(o.bytes) }; }
};
let server;
try {
    const prior = await owner.query('SELECT count(*)::integer AS n FROM cs.tenants');
    assert.equal(prior.rows[0].n, 0, 'Use a fresh empty test database, not a live or previously populated schema.');
    await tested('non-owner application and worker roles', async () => { await assertRuntimeRole(api); await assertRuntimeRole(worker, true); });
    const password = 'Integration-only-Password-123!';
    const encoded = await passwordHash(password);
    async function fixture(name) {
        const tenant = id(), campus = id(), period = id(), people = {};
        await owner.query('BEGIN');
        try {
            await owner.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
            await owner.query('INSERT INTO cs.tenants(id,name) VALUES($1,$2)', [tenant, name]);
            for (const role of ['ADMIN', 'ENTRY', 'REVIEWER', 'LEADERSHIP']) {
                const uid = id();
                people[role] = { id: uid, tenant_id: tenant, role, email: role.toLowerCase() + '@integration.example' };
                await owner.query('INSERT INTO cs.users(id,tenant_id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)', [uid, tenant, role, people[role].email, role, encoded]);
            }
            await owner.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4)', [campus, tenant, 'Test Campus', 'TEST']);
            await owner.query('INSERT INTO cs.periods(id,tenant_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5)', [period, tenant, 'Test FY', '2026-04-01', '2027-03-31']);
            await owner.query('COMMIT');
        }
        catch (e) {
            await owner.query('ROLLBACK');
            throw e;
        }
        return { tenant, campus, period, ...people };
    }
    const a = await fixture('Integration tenant A'), b = await fixture('Integration tenant B');
    await tested('RLS with no context exposes zero tenants', async () => assert.equal((await api.query('SELECT * FROM cs.tenants')).rowCount, 0));
    await tested('tenant context cannot read another tenant or leak through pool reuse', async () => { await tenantTx(api, a.tenant, async (c) => { assert.equal((await c.query('SELECT * FROM cs.tenants')).rowCount, 1); assert.equal((await c.query('SELECT * FROM cs.users WHERE tenant_id=$1', [b.tenant])).rowCount, 0); }); assert.equal((await api.query('SELECT * FROM cs.users')).rowCount, 0); });
    await tested('RLS blocks cross-tenant inserts', async () => assert.rejects(tenantTx(api, a.tenant, c => c.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4)', [id(), b.tenant, 'Bad', 'BAD'])), e => e.code === '42501'));
    await tested('worker cannot read password/session tables', async () => assert.rejects(worker.query('SELECT * FROM cs.users'), e => e.code === '42501'));
    const session = await login(api, { tenantId: a.tenant, email: a.ENTRY.email, password }, 'integration');
    await tested('opaque session authentication derives tenant and role', async () => { const u = await authenticate(api, 'Bearer ' + session.token); assert.equal(u.tenant_id, a.tenant); assert.equal(u.role, 'ENTRY'); assert.equal(u.password_hash, undefined); });
    const factorBody = { category: 'PURCHASED_ELECTRICITY', unit: 'kWh', value: '0.71', versionLabel: 'TEST-ONLY', source: 'SYNTHETIC integration factor; not for real reporting', sourceUrl: 'https://example.com/test-only', region: 'TEST', methodology: 'Synthetic test multiplication only', validFrom: '2026-04-01', validTo: '2027-03-31' };
    const factor = await createResource(api, a.ADMIN, 'factors', factorBody, 'factor-test-00001');
    await tested('factor author cannot approve their own factor', async () => assert.rejects(approveFactor(api, a.ADMIN, factor.id), e => e.code === 'SELF_APPROVAL'));
    await tested('separate reviewer approves factor and it becomes immutable', async () => { await approveFactor(api, a.REVIEWER, factor.id); await assert.rejects(tenantTx(api, a.tenant, c => c.query('UPDATE cs.factors SET value=1 WHERE id=$1', [factor.id])), e => e.code === '42501'); });
    const body = { periodId: a.period, campusId: a.campus, category: 'PURCHASED_ELECTRICITY', unit: 'kWh', quantity: '100.000001', activityDate: '2026-06-01', description: 'Integration test only' };
    let activity;
    await tested('parallel same-key create commits one activity and one audit', async () => { const [x, y] = await Promise.all([createActivity(api, a.ENTRY, body, 'manual-test-0001'), createActivity(api, a.ENTRY, body, 'manual-test-0001')]); assert.equal(x.id, y.id); activity = x; assert.equal((await owner.query("SELECT count(*)::int AS n FROM cs.audit_events WHERE entity_id=$1 AND action='ACTIVITY_CREATED'", [x.id])).rows[0].n, 1); });
    await tested('same idempotency key with another body conflicts', async () => assert.rejects(createActivity(api, a.ENTRY, { ...body, quantity: '102' }, 'manual-test-0001'), e => e.code === 'IDEMPOTENCY_CONFLICT'));
    await tested('cross-tenant resource IDs are not disclosed', async () => assert.rejects(getActivity(api, b.ADMIN, activity.id), e => e.code === 'NOT_FOUND'));
    await tested('leadership cannot create records', async () => assert.rejects(createActivity(api, a.LEADERSHIP, body, 'leader-test-0001'), e => e.code === 'FORBIDDEN'));
    const instance = createApp(cfg, services(api, storage, cfg), { log: () => { } });
    server = instance.server;
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    await tested('real HTTP + PostgreSQL list returns authenticated tenant data', async () => { const r = await fetch(base + '/api/v2/activities', { headers: { Authorization: 'Bearer ' + session.token } }); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.data.items.length, 1); assert.equal(j.data.items[0].id, activity.id); });
    await tested('stale workflow version does not advance record', async () => assert.rejects(transition(api, a.ENTRY, activity.id, 'submit', { version: 99 }), e => e.code === 'STALE_VERSION'));
    activity = await transition(api, a.ENTRY, activity.id, 'submit', { version: activity.version });
    activity = await transition(api, a.REVIEWER, activity.id, 'start-review', { version: activity.version });
    await tested('creator cannot approve even with administrator role', async () => assert.rejects(transition(api, { ...a.ENTRY, role: 'ADMIN' }, activity.id, 'verify', { version: activity.version, factorId: factor.id }), e => e.code === 'SELF_APPROVAL'));
    activity = await transition(api, a.REVIEWER, activity.id, 'verify', { version: activity.version, factorId: factor.id });
    await tested('verification atomically enqueues exactly one calculation job', async () => assert.equal((await owner.query("SELECT count(*)::int AS n FROM cs.jobs WHERE entity_id=$1 AND kind='CALCULATE'", [activity.id])).rows[0].n, 1));
    await tested('period with pending calculation cannot lock', async () => assert.rejects(setPeriod(api, a.ADMIN, a.period, { version: 1, reason: 'Integration close test' }, true), e => e.code === 'PENDING_ACTIVITIES'));
    const job = await claimJob(worker);
    assert.equal(job.entity_id, activity.id);
    await processCalculation(worker, job);
    await tested('NUMERIC calculation and monthly totals reconcile exactly', async () => { const row = await getActivity(api, a.ADMIN, activity.id); assert.equal(row.calculation.kg_co2e, '71.000001'); const dash = await dashboard(api, a.ADMIN); assert.equal(dash.totals.kg_co2e, '71.000001'); assert.equal(dash.totals.calculated_records, '1'); });
    await tested('stale lease cannot finalize a completed job', async () => assert.rejects(tenantTx(worker, a.tenant, c => ownedJob(c, job)), e => e.code === 'LEASE_LOST'));
    await owner.query("UPDATE cs.jobs SET status='QUEUED',available_at=now(),attempts=0 WHERE id=$1", [job.id]);
    const redelivery = await claimJob(worker);
    await processCalculation(worker, redelivery);
    await tested('job redelivery does not double-count a calculation', async () => { assert.equal((await dashboard(api, a.ADMIN)).totals.calculated_records, '1'); assert.equal((await owner.query('SELECT count(*)::int AS n FROM cs.calculations WHERE activity_id=$1', [activity.id])).rows[0].n, 1); });
    await tested('API cannot alter immutable ledger or audit', async () => { await assert.rejects(tenantTx(api, a.tenant, c => c.query('DELETE FROM cs.calculations WHERE activity_id=$1', [activity.id])), e => e.code === '42501'); await assert.rejects(tenantTx(api, a.tenant, c => c.query('DELETE FROM cs.audit_events WHERE entity_id=$1', [activity.id])), e => e.code === '42501'); });
    const bytes = Buffer.from('Vendor: Integration Utility\nInvoice Number: TEST-100\nDate: 2026-06-02\nConsumption: 200 kWh\nAmount: INR 2000');
    let doc = await upload(api, storage, a.ENTRY, 'test-invoice.txt', 'text/plain', bytes, 'invoice-test-0001');
    await tested('same upload retry returns one document and one storage object', async () => { const replay = await upload(api, storage, a.ENTRY, 'test-invoice.txt', 'text/plain', bytes, 'invoice-test-0001'); assert.equal(replay.id, doc.id); assert.equal(objects.size, 1); });
    await tested('unscanned invoice cannot download or create an activity', async () => { await assert.rejects(download(api, storage, a.ADMIN, doc.id), e => e.code === 'QUARANTINED'); await assert.rejects(confirmInvoice(api, a.ENTRY, doc.id, { ...body, quantity: '200', activityDate: '2026-06-02', version: doc.version, vendor: 'Test', invoiceNumber: 'TEST-100', reviewConfirmed: true }, 'invoice-confirm-01'), e => e.code === 'INVOICE_NOT_READY'); });
    const scanJob = await claimJob(worker);
    assert.equal(scanJob.kind, 'SCAN_INVOICE');
    await processInvoice(worker, storage, async () => ({ status: 'CLEAN', engine: 'CONTROLLED TEST FIXTURE - NOT ANTIVIRUS' }), async () => ({ ocrAvailable: false, fields: {}, warnings: ['Test fixture'] }), scanJob);
    doc = await getDocument(api, a.ADMIN, doc.id);
    await tested('after controlled scan fixture, pinned original bytes download intact', async () => assert.deepEqual((await download(api, storage, a.ADMIN, doc.id)).bytes, bytes));
    const invoice = await confirmInvoice(api, a.ENTRY, doc.id, { ...body, quantity: '200', activityDate: '2026-06-02', version: doc.version, vendor: 'Test Utility', invoiceNumber: 'TEST-100', amountInr: '2000.00', reviewConfirmed: true }, 'invoice-confirm-02');
    await tested('confirmed invoice separates money and quantity', async () => { assert.equal(invoice.quantity, '200.000000'); assert.equal(invoice.amount_inr, '2000.00'); assert.equal(invoice.document_id, doc.id); });
    const q = (await owner.query('SELECT storage_used_bytes FROM cs.tenants WHERE id=$1', [a.tenant])).rows[0];
    assert.equal(q.storage_used_bytes, String(bytes.length));
    await tested('tenant quota blocks a new document atomically', async () => { await owner.query('UPDATE cs.tenants SET storage_quota_bytes=storage_used_bytes WHERE id=$1', [a.tenant]); await assert.rejects(upload(api, storage, a.ENTRY, 'new.txt', 'text/plain', Buffer.from('Another valid invoice'), 'invoice-test-0002'), e => e.code === 'STORAGE_QUOTA'); await owner.query('UPDATE cs.tenants SET storage_quota_bytes=1000000 WHERE id=$1', [a.tenant]); });
    let uncertaintyId;
    await tested('ambiguous object PUT retains durable UPLOADING operation', async () => { await assert.rejects(upload(api, { ...storage, put: async () => { throw Error('transport failure'); } }, a.ENTRY, 'uncertain.txt', 'text/plain', Buffer.from('Uncertain invoice bytes'), 'uncertain-test-001'), e => e.code === 'STORAGE_UNCERTAIN'); uncertaintyId = (await owner.query("SELECT id FROM cs.documents WHERE tenant_id=$1 AND status='UPLOADING'", [a.tenant])).rows[0].id; });
    await owner.query("UPDATE cs.documents SET upload_deadline=now()-interval '1 second' WHERE id=$1", [uncertaintyId]);
    await reconcileUpload(worker, storage, a.tenant, uncertaintyId);
    await tested('missing-object reconciliation fails upload and releases reserved quota', async () => { assert.equal((await getDocument(api, a.ADMIN, uncertaintyId)).status, 'UPLOAD_FAILED'); assert.equal((await owner.query('SELECT storage_used_bytes FROM cs.tenants WHERE id=$1', [a.tenant])).rows[0].storage_used_bytes, String(bytes.length)); });
    await tested('last active admin cannot demote themselves', async () => assert.rejects(updateUser(api, a.ADMIN, a.ADMIN.id, { role: 'ENTRY', active: true }), e => e.code === 'LAST_ADMIN'));
    console.log(JSON.stringify({ suite: 'PostgreSQL integration', groupsPassed: assertions, storage: 'controlled in-memory fixture', antivirus: 'controlled fixture; NOT live ClamAV', database: 'real PostgreSQL', productionApproval: false }));
}
finally {
    if (server)
        await new Promise(r => server.close(r));
    await api.end();
    await worker.end();
    await owner.end();
}
