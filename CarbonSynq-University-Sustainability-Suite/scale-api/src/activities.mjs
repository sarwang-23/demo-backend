import { assertEvidenceAccess } from './operations/access.mjs';
import { id, uuid, role, WRITERS, fail, activityInput, fingerprint, version, workflow, pagination, page, text, decimal } from './core.mjs';
import { tenantTx, audit, idempotent, enqueue } from './db.mjs';
export async function openPeriod(c, tenantId, periodId) {
    const p = (await c.query('SELECT * FROM cs.periods WHERE tenant_id=$1 AND id=$2 FOR SHARE', [tenantId, periodId])).rows[0];
    if (!p)
        fail(422, 'INVALID_PERIOD', 'Period does not belong to this tenant.');
    if (p.status !== 'OPEN')
        fail(409, 'PERIOD_LOCKED', 'Reporting period is locked.');
    return p;
}
export async function validateReferences(c, user, a) {
    const p = await openPeriod(c, user.tenant_id, a.periodId);
    if (a.activityDate < p.start_date || a.activityDate > p.end_date)
        fail(422, 'DATE_OUTSIDE_PERIOD', 'Activity date must fall within the selected period.');
    if ((await c.query('SELECT 1 FROM cs.u_c_period_modes WHERE tenant_id=$1 AND period_id=$2', [user.tenant_id,a.periodId])).rows.length)
        fail(409, 'ENHANCED_SCOPE12_ACTIVE', 'Use /api/v2/university/carbon/records for Scope 1/2 in this activated period.');
    const campus = (await c.query('SELECT id FROM cs.campuses WHERE tenant_id=$1 AND id=$2', [user.tenant_id, a.campusId])).rows[0];
    if (!campus)
        fail(422, 'INVALID_CAMPUS', 'Campus does not belong to this tenant.');
    if (a.buildingId) {
        const b = (await c.query('SELECT id FROM cs.buildings WHERE tenant_id=$1 AND campus_id=$2 AND id=$3', [user.tenant_id, a.campusId, a.buildingId])).rows[0];
        if (!b)
            fail(422, 'INVALID_BUILDING', 'Building does not belong to this campus.');
    }
}
export async function insertActivity(c, user, a, evidence = {}) {
    const row = (await c.query(`INSERT INTO cs.activities(id,tenant_id,period_id,campus_id,building_id,category,scope,unit,quantity,activity_date,description,input_source,document_id,amount_inr,vendor,invoice_number,fingerprint,duplicate_slot,duplicate_reason,created_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`, [id(), user.tenant_id, a.periodId, a.campusId, a.buildingId, a.category, a.scope, a.unit, a.quantity, a.activityDate, a.description, evidence.documentId ? 'INVOICE' : 'MANUAL', evidence.documentId || null, evidence.amountInr || null, evidence.vendor || null, evidence.invoiceNumber || null, fingerprint(a), a.duplicateReason ? id() : '', a.duplicateReason, user.id])).rows[0];
    await audit(c, user, 'ACTIVITY_CREATED', row.id, { source: row.input_source, quantity: row.quantity, unit: row.unit, duplicateReason: a.duplicateReason });
    return row;
}
export async function createActivity(pool, user, body, key) {
    role(user, WRITERS);
    const a = activityInput(body);
    return tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'activities.create', key, body, async () => { await validateReferences(c, user, a); return insertActivity(c, user, a); }));
}
export async function getActivity(pool, user, activityId) {
    uuid(activityId);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const a = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2', [user.tenant_id, activityId])).rows[0];
        if (!a || (user.role === 'ENTRY' && a.created_by !== user.id))
            fail(404, 'NOT_FOUND', 'Activity not found.');
        a.calculation = (await c.query('SELECT * FROM cs.calculations WHERE tenant_id=$1 AND activity_id=$2', [user.tenant_id, activityId])).rows[0] || null;
        return a;
    });
}
export async function listActivities(pool, user, query) {
    const { limit, cursor } = pagination(query);
    const params = [user.tenant_id, limit + 1];
    const filters = ['tenant_id=$1'];
    if (cursor) {
        params.push(...cursor);
        filters.push('(created_at,id)<($3::timestamptz,$4::uuid)');
    }
    for (const [key, col] of [['periodId', 'period_id'], ['campusId', 'campus_id'], ['status', 'status']])
        if (query[key]) {
            params.push(key === 'status' ? text(query[key], key, 30) : uuid(query[key]));
            filters.push(`${col}=$${params.length}`);
        }
    if (user.role === 'ENTRY') { params.push(user.id); filters.push(`created_by=$${params.length}`); }
    return tenantTx(pool, user.tenant_id, async (c) => page((await c.query(`SELECT * FROM cs.activities WHERE ${filters.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $2`, params)).rows, limit));
}
export async function editActivity(pool, user, activityId, body) {
    role(user, WRITERS);
    uuid(activityId);
    const a = activityInput(body);
    return tenantTx(pool, user.tenant_id, async (c) => {
        // Lock both period rows in UUID order before the activity, avoiding opposing edits deadlocking.
        const seen = (await c.query('SELECT period_id FROM cs.activities WHERE tenant_id=$1 AND id=$2', [user.tenant_id, activityId])).rows[0];
        if (!seen)
            fail(404, 'NOT_FOUND', 'Activity not found.');
        for (const pid of [...new Set([seen.period_id, a.periodId])].sort())
            await openPeriod(c, user.tenant_id, pid);
        const old = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, activityId])).rows[0];
        version(old, body.version);
        if (old.period_id !== seen.period_id)
            fail(409, 'STALE_VERSION', 'Period changed. Reload the activity.');
        if (!['DRAFT', 'REJECTED'].includes(old.status))
            fail(409, 'INVALID_STATE', 'Only draft or rejected records can be edited.');
        if (user.role !== 'ADMIN' && old.created_by !== user.id)
            fail(403, 'NOT_OWNER', 'Only the owner or admin can edit.');
        await validateReferences(c, user, a);
        const row = (await c.query(`UPDATE cs.activities SET period_id=$3,campus_id=$4,building_id=$5,category=$6,scope=$7,unit=$8,quantity=$9,activity_date=$10,description=$11,fingerprint=$12,duplicate_slot=$13,duplicate_reason=$14,status='DRAFT',factor_id=NULL,verified_by=NULL,rejection_reason=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [user.tenant_id, activityId, a.periodId, a.campusId, a.buildingId, a.category, a.scope, a.unit, a.quantity, a.activityDate, a.description, fingerprint(a), a.duplicateReason ? (old.duplicate_slot || id()) : '', a.duplicateReason])).rows[0];
        await audit(c, user, 'ACTIVITY_EDITED', activityId, { before: old, after: row });
        return row;
    });
}
export async function transition(pool, user, activityId, action, body) {
    uuid(activityId);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const seen = (await c.query('SELECT period_id FROM cs.activities WHERE tenant_id=$1 AND id=$2', [user.tenant_id, activityId])).rows[0];
        if (!seen)
            fail(404, 'NOT_FOUND', 'Activity not found.');
        await openPeriod(c, user.tenant_id, seen.period_id);
        const old = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, activityId])).rows[0];
        if (old.period_id !== seen.period_id)
            fail(409, 'STALE_VERSION', 'Record changed. Reload it.');
        const next = workflow(old, action, user, body);
        let factorId = old.factor_id;
        if (action === 'verify') {
            factorId = uuid(body.factorId, 'factorId');
            const f = (await c.query(`SELECT * FROM cs.factors WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'`, [user.tenant_id, factorId])).rows[0];
            if (!f || f.category !== old.category || f.unit !== old.unit || f.scope !== old.scope || old.activity_date < f.valid_from || old.activity_date > f.valid_to)
                fail(422, 'INVALID_FACTOR', 'Select an approved factor with matching category, unit, scope and validity dates.');
        }
        const row = (await c.query('UPDATE cs.activities SET status=$3,verified_by=$4,factor_id=$5,rejection_reason=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [user.tenant_id, activityId, next.status, action === 'verify' ? user.id : old.verified_by, factorId, next.reason])).rows[0];
        if (action === 'verify')
            await enqueue(c, user.tenant_id, 'CALCULATE', activityId);
        await audit(c, user, 'ACTIVITY_' + next.status, activityId, { beforeStatus: old.status, version: row.version, reason: next.reason, factorId });
        return row;
    });
}
export async function confirmInvoice(pool, user, documentId, body, key) {
    role(user, WRITERS);
    uuid(documentId);
    const a = activityInput(body);
    if (body.reviewConfirmed !== true)
        fail(422, 'REVIEW_REQUIRED', 'A person must check the original invoice and confirm actual consumption.');
    const vendor = text(body.vendor, 'vendor', 150), invoiceNumber = text(body.invoiceNumber, 'invoiceNumber', 80);
    const amountInr = body.amountInr === undefined || body.amountInr === null || body.amountInr === '' ? null : decimal(body.amountInr, 'amountInr', 2, true);
    return tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'invoice.confirm:' + documentId, key, body, async () => {
        await validateReferences(c, user, a);
        const doc = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, documentId])).rows[0];
        if (!doc)
            fail(404, 'NOT_FOUND', 'Document not found.');
        await assertEvidenceAccess(c, user, doc);
        version(doc, body.version);
        if (doc.status !== 'REVIEW_REQUIRED' || doc.scan_result !== 'CLEAN')
            fail(409, 'INVOICE_NOT_READY', 'Invoice must pass scanning before human review.');
        const invoiceKey = vendor.toLowerCase().replace(/\s+/g, ' ') + '|' + invoiceNumber.toUpperCase().replace(/\s+/g, '');
        const row = await insertActivity(c, user, a, { documentId, amountInr, vendor, invoiceNumber });
        await c.query("UPDATE cs.documents SET status='LINKED',invoice_key=$3,reviewed=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2", [user.tenant_id, documentId, invoiceKey, JSON.stringify({ vendor, invoiceNumber, amountInr, activityId: row.id, consumption: a.quantity, unit: a.unit, confirmedBy: user.id })]);
        await audit(c, user, 'INVOICE_CONFIRMED', documentId, { activityId: row.id });
        return row;
    }));
}
