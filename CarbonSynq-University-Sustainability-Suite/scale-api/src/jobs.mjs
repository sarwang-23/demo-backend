import { id, uuid, hash, fail, role, text } from './core.mjs';
import { tenantTx, audit, enqueue } from './db.mjs';
import { openPeriod } from './activities.mjs';
export async function claimJob(pool, leaseSeconds = 180) {
    await pool.query("UPDATE cs.jobs SET status='DEAD',lease_token=NULL,lease_until=NULL,last_error='LEASE_EXHAUSTED',updated_at=now() WHERE status='RUNNING' AND lease_until<now() AND attempts>=max_attempts");
    return (await pool.query(`WITH candidate AS (
    SELECT id FROM cs.jobs WHERE attempts<max_attempts AND ((status='QUEUED' AND available_at<=now()) OR (status='RUNNING' AND lease_until<now()))
    ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE cs.jobs j SET status='RUNNING',attempts=j.attempts+1,lease_token=$1,lease_until=now()+$2*interval '1 second',updated_at=now()
  FROM candidate WHERE j.id=candidate.id RETURNING j.*`, [id(), leaseSeconds])).rows[0] || null;
}
export async function ownedJob(c, job) {
    const r = (await c.query("SELECT * FROM cs.jobs WHERE id=$1 AND tenant_id=$2 AND status='RUNNING' AND lease_token=$3 AND lease_until>now() FOR UPDATE", [job.id, job.tenant_id, job.lease_token])).rows[0];
    if (!r)
        fail(409, 'LEASE_LOST', 'Worker lease is no longer valid.');
    return r;
}
export async function done(c, job) { await c.query("UPDATE cs.jobs SET status='DONE',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND lease_token=$3", [job.id, job.tenant_id, job.lease_token]); }
export async function failJob(pool, job, error) {
    const code = error?.code === 'PERIOD_LOCKED' ? 'PERIOD_LOCKED' : error?.message === 'SCAN_TIMEOUT' ? 'SCAN_TIMEOUT' : error?.code === 'LEASE_LOST' ? 'LEASE_LOST' : 'PROCESSING_FAILED';
    const delay = Math.min(900, 2 ** job.attempts * 5) + Math.floor(Math.random() * 5);
    await pool.query(`UPDATE cs.jobs SET status=CASE WHEN attempts>=max_attempts THEN 'DEAD' ELSE 'QUEUED' END,available_at=now()+$4*interval '1 second',lease_token=NULL,lease_until=NULL,last_error=$5,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND lease_token=$3`, [job.id, job.tenant_id, job.lease_token, delay, code]);
}
export async function processCalculation(pool, job) {
    return tenantTx(pool, job.tenant_id, async (c) => {
        await ownedJob(c, job);
        const tenant = (await c.query("SELECT status FROM cs.tenants WHERE id=$1", [job.tenant_id])).rows[0];
        if (tenant?.status !== 'ACTIVE')
            fail(409, 'TENANT_SUSPENDED', 'Tenant is suspended.');
        const seen = (await c.query('SELECT period_id FROM cs.activities WHERE tenant_id=$1 AND id=$2', [job.tenant_id, job.entity_id])).rows[0];
        if (!seen)
            fail(404, 'NOT_FOUND', 'Activity not found.');
        await openPeriod(c, job.tenant_id, seen.period_id);
        const a = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [job.tenant_id, job.entity_id])).rows[0];
        if (a.status === 'CALCULATED') {
            await done(c, job);
            return;
        }
        if (a.status !== 'VERIFIED' || !a.verified_by || a.verified_by === a.created_by)
            fail(409, 'NOT_VERIFIED', 'Activity must be independently verified.');
        const f = (await c.query("SELECT * FROM cs.factors WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'", [job.tenant_id, a.factor_id])).rows[0];
        if (!f || f.category !== a.category || f.unit !== a.unit || f.scope !== a.scope || a.activity_date < f.valid_from || a.activity_date > f.valid_to)
            fail(422, 'INVALID_FACTOR', 'Approved factor no longer matches.');
        // Insert, aggregate update, activity state and job acknowledgement are one transaction.
        const cal = (await c.query(`INSERT INTO cs.calculations(id,tenant_id,activity_id,factor_id,quantity,factor_value,kg_co2e,factor_version,factor_source,provenance)
      VALUES($1,$2,$3,$4,$5,$6,round($5::numeric*$6::numeric,6),$7,$8,$9) ON CONFLICT(tenant_id,activity_id) DO NOTHING RETURNING *`, [id(), job.tenant_id, a.id, f.id, a.quantity, f.value, f.version_label, f.source, JSON.stringify({ sourceUrl: f.source_url, region: f.region, methodology: f.methodology, unit: f.unit, validFrom: f.valid_from, validTo: f.valid_to, approvedBy: f.approved_by, verifiedBy: a.verified_by })])).rows[0];
        if (cal)
            await c.query(`INSERT INTO cs.monthly_totals(tenant_id,period_id,campus_id,month,scope,category,kg_co2e,record_count,evidence_count) VALUES($1,$2,$3,date_trunc('month',$4::date)::date,$5,$6,$7,1,$8)
      ON CONFLICT(tenant_id,period_id,campus_id,month,scope,category) DO UPDATE SET kg_co2e=cs.monthly_totals.kg_co2e+EXCLUDED.kg_co2e,record_count=cs.monthly_totals.record_count+1,evidence_count=cs.monthly_totals.evidence_count+EXCLUDED.evidence_count`, [job.tenant_id, a.period_id, a.campus_id, a.activity_date, a.scope, a.category, cal.kg_co2e, a.document_id ? 1 : 0]);
        await c.query("UPDATE cs.activities SET status='CALCULATED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2", [job.tenant_id, a.id]);
        await audit(c, { tenant_id: job.tenant_id }, 'ACTIVITY_CALCULATED', a.id, { jobId: job.id, factorId: f.id, kgCO2e: cal?.kg_co2e || null });
        await done(c, job);
    });
}
export async function processInvoice(pool, storage, scanner, extractor, job) {
    const d = await tenantTx(pool, job.tenant_id, async (c) => (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2', [job.tenant_id, job.entity_id])).rows[0]);
    if (!d)
        fail(404, 'NOT_FOUND', 'Invoice not found.');
    if (d.status !== 'QUEUED')
        return tenantTx(pool, job.tenant_id, async (c) => { await ownedJob(c, job); if (['LINKED', 'REVIEW_REQUIRED', 'REJECTED'].includes(d.status))
            await done(c, job);
        else
            fail(409, 'INVALID_STATE', 'Invoice not queued.'); });
    const bytes = await storage.get(d.object_key, d.object_version, Number(d.file_size));
    if (hash(bytes) !== d.sha256 || bytes.length !== Number(d.file_size))
        fail(409, 'EVIDENCE_INTEGRITY', 'Invoice digest mismatch.');
    const scan = await scanner(bytes);
    if (!['CLEAN', 'INFECTED'].includes(scan.status))
        throw Error('Unexpected scanner result');
    const extraction = scan.status === 'CLEAN' ? await extractor(bytes, d.mime_type) : null;
    return tenantTx(pool, job.tenant_id, async (c) => {
        await ownedJob(c, job);
        const changed = await c.query("UPDATE cs.documents SET status=$3,scan_result=$4,scan_engine=$5,extraction=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='QUEUED' AND object_version=$7", [job.tenant_id, d.id, scan.status === 'CLEAN' ? 'REVIEW_REQUIRED' : 'REJECTED', scan.status, scan.engine, extraction ? JSON.stringify(extraction) : null, d.object_version]);
        if (changed.rowCount)
            await audit(c, { tenant_id: job.tenant_id }, 'INVOICE_SCANNED', d.id, { result: scan.status, jobId: job.id });
        await done(c, job);
    });
}
export async function retryJob(pool, user, jobId, body) {
    role(user, ['ADMIN']);
    uuid(jobId);
    const reason = text(body.reason, 'reason', 500);
    if (reason.length < 10)
        fail(422, 'REASON_REQUIRED', 'Explain why this job should be retried.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        const row = (await c.query("UPDATE cs.jobs SET status='QUEUED',attempts=0,lease_token=NULL,lease_until=NULL,available_at=now(),last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='DEAD' RETURNING *", [user.tenant_id, jobId])).rows[0];
        if (!row)
            fail(409, 'NOT_RETRYABLE', 'Job is not in the dead-letter queue.');
        await audit(c, user, 'JOB_RETRIED', jobId, { reason });
        return row;
    });
}
export async function reconcileUpload(pool, storage, tenantId, documentId) {
    const d = await tenantTx(pool, tenantId, async (c) => (await c.query("SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 AND status='UPLOADING' AND upload_deadline<now()", [tenantId, documentId])).rows[0]);
    if (!d)
        return;
    let stored = null;
    try {
        stored = await storage.head(d.object_key);
    }
    catch (e) {
        if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== 'NotFound' && e?.name !== 'NoSuchKey')
            throw e;
    }
    if (stored && (!stored.versionId || stored.versionId === 'null' || stored.sha256 !== d.sha256 || Number(stored.size) !== Number(d.file_size)))
        throw Error('RECONCILIATION_INTEGRITY_FAILURE');
    await tenantTx(pool, tenantId, async (c) => {
        const current = (await c.query("SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 AND status='UPLOADING' AND object_key=$3 FOR UPDATE", [tenantId, documentId, d.object_key])).rows[0];
        if (!current)
            return;
        if (stored) {
            await c.query("UPDATE cs.documents SET status='QUEUED',object_version=$3,version=version+1 WHERE tenant_id=$1 AND id=$2", [tenantId, documentId, stored.versionId]);
            await enqueue(c, tenantId, 'SCAN_INVOICE', documentId);
        }
        else {
            if (current.quota_reserved)
                await c.query('UPDATE cs.tenants SET storage_used_bytes=storage_used_bytes-$2 WHERE id=$1', [tenantId, Number(d.file_size)]);
            await c.query("UPDATE cs.documents SET status='UPLOAD_FAILED',quota_reserved=false,version=version+1 WHERE tenant_id=$1 AND id=$2", [tenantId, documentId]);
        }
        await audit(c, { tenant_id: tenantId }, stored ? 'UPLOAD_RECOVERED' : 'UPLOAD_FAILED', documentId);
    });
}
