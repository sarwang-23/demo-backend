import { uuid, fail, text, role } from './core.mjs';
import { tenantTx } from './db.mjs';
export async function dashboard(pool, user, query = {}) {
    const periodId = query.periodId ? uuid(query.periodId) : null;
    return tenantTx(pool, user.tenant_id, async (c) => {
        const p = [user.tenant_id, periodId];
        const totals = (await c.query(`SELECT coalesce(sum(kg_co2e),0)::text AS kg_co2e,round(coalesce(sum(kg_co2e),0)/1000,6)::text AS tonnes_co2e,
      coalesce(sum(record_count),0)::text AS calculated_records,coalesce(sum(evidence_count),0)::text AS invoice_backed_records FROM cs.monthly_totals WHERE tenant_id=$1 AND ($2::uuid IS NULL OR period_id=$2)`, p)).rows[0];
        const monthly = (await c.query(`SELECT month::text,scope,sum(kg_co2e)::text AS kg_co2e FROM cs.monthly_totals WHERE tenant_id=$1 AND ($2::uuid IS NULL OR period_id=$2) GROUP BY month,scope ORDER BY month DESC,scope LIMIT 240`, p)).rows;
        const campuses = (await c.query(`SELECT m.campus_id,c.name,sum(m.kg_co2e)::text AS kg_co2e FROM cs.monthly_totals m JOIN cs.campuses c ON c.id=m.campus_id AND c.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.period_id=$2) GROUP BY m.campus_id,c.name ORDER BY sum(m.kg_co2e) DESC LIMIT 100`, p)).rows;
        const pipeline = (await c.query('SELECT status,count(*)::text AS count FROM cs.activities WHERE tenant_id=$1 AND ($2::uuid IS NULL OR period_id=$2) GROUP BY status', p)).rows;
        const jobs = (await c.query('SELECT status,count(*)::text AS count FROM cs.jobs WHERE tenant_id=$1 GROUP BY status', [user.tenant_id])).rows;
        return { totals, monthly, campuses, pipeline, jobs, accountingBoundary: 'Scope 1 and location-based Scope 2 only. Factors are selected and approved by your organization.', evidenceDefinition: 'Count of calculated records linked to a scanned invoice; not independent assurance.', displayLimits: { monthlyRows: 240, campuses: 100 } };
    });
}
export async function auditList(pool, user, query = {}) {
    role(user, ['ADMIN','REVIEWER','LEADERSHIP']);
    const limit = Number(query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(422, 'INVALID_LIMIT', 'limit must be 1 to 100.');
    const before = query.before ? text(query.before, 'before', 20) : null;
    if (before && !/^[1-9][0-9]{0,18}$/.test(before))
        fail(422, 'INVALID_CURSOR', 'before must be a positive audit ID.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        const rows = (await c.query('SELECT * FROM cs.audit_events WHERE tenant_id=$1 AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT $2', [user.tenant_id, limit + 1, before])).rows;
        return { items: rows.slice(0, limit), nextBefore: rows.length > limit ? rows[limit - 1].id : null };
    });
}
export async function ledger(pool, user, query = {}) {
    role(user, ['ADMIN','REVIEWER','LEADERSHIP']);
    const limit = Number(query.limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(422, 'INVALID_LIMIT', 'limit must be 1 to 100.');
    const after = query.after ? uuid(query.after) : null, periodId = query.periodId ? uuid(query.periodId) : null;
    return tenantTx(pool, user.tenant_id, async (c) => {
        const rows = (await c.query(`SELECT a.id,a.period_id,a.campus_id,a.building_id,a.activity_date,a.category,a.scope,a.quantity,a.unit,a.status,a.document_id,
      cal.kg_co2e,cal.factor_value,cal.factor_version,cal.factor_source,cal.provenance,d.sha256 AS evidence_sha256 FROM cs.activities a
      LEFT JOIN cs.calculations cal ON cal.tenant_id=a.tenant_id AND cal.activity_id=a.id LEFT JOIN cs.documents d ON d.tenant_id=a.tenant_id AND d.id=a.document_id
      WHERE a.tenant_id=$1 AND ($3::uuid IS NULL OR a.id>$3) AND ($4::uuid IS NULL OR a.period_id=$4) ORDER BY a.id LIMIT $2`, [user.tenant_id, limit + 1, after, periodId])).rows;
        return { items: rows.slice(0, limit), nextAfter: rows.length > limit ? rows[limit - 1].id : null, consistency: 'Live pages, not a point-in-time snapshot. Lock the period before a final export.' };
    });
}
