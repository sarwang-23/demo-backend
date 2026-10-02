import { evidencePredicate } from './operations/access.mjs';
import { id, text, uuid, day, decimal, role, fail, CATEGORIES, passwordHash, version, pagination, page } from './core.mjs';
import { tenantTx, audit, idempotent } from './db.mjs';
import { UniversityStore } from './university/store.mjs';
import { readiness as carbonReadiness } from './university/carbon/reporting.mjs';
export async function metadata(pool, user) {
    return tenantTx(pool, user.tenant_id, async (c) => {
        const tenant = (await c.query('SELECT id,name,status,storage_quota_bytes,storage_used_bytes FROM cs.tenants WHERE id=$1', [user.tenant_id])).rows[0];
        const result = { tenant, categories: CATEGORIES, limits: { metadataListLimit: 500, uploadBytes: 10485760 }, ocrAvailable: process.env.OCR_ENABLED === 'true' };
        for (const t of ['campuses', 'buildings', 'periods', 'factors'])
            result[t] = (await c.query(`SELECT * FROM cs.${t} WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500`, [user.tenant_id])).rows;
        return result;
    });
}
export async function listResource(pool, user, kind, query) {
    if (!['campuses', 'buildings', 'periods', 'factors', 'users', 'documents', 'jobs'].includes(kind))
        fail(404, 'NOT_FOUND', 'Resource not found.');
    if (kind === 'users')
        role(user, ['ADMIN']);
    const { limit, cursor } = pagination(query);
    const columns = kind === 'users' ? 'id,tenant_id,name,email,role,active,created_at' : kind === 'documents' ? 'id,original_name,mime_type,file_size,sha256,status,scan_result,scan_engine,extraction,reviewed,version,created_at' : kind === 'jobs' ? 'id,kind,entity_id,status,attempts,max_attempts,available_at,last_error,created_at' : '*';
    return tenantTx(pool, user.tenant_id, async (c) => {
        const params=[user.tenant_id,limit+1,...(cursor||[])];
        const acl=kind==='documents'?' AND '+evidencePredicate(user,params,'documents'):'';
        if(kind==='jobs')role(user,['ADMIN','REVIEWER']);
        return page((await c.query(`SELECT ${columns} FROM cs.${kind} WHERE tenant_id=$1 ${cursor ? 'AND (created_at,id)<($3::timestamptz,$4::uuid)' : ''}${acl} ORDER BY created_at DESC,id DESC LIMIT $2`,params)).rows,limit);
    });
}
export async function createResource(pool, user, kind, body, key) {
    role(user, ['ADMIN']);
    if (!['campuses', 'buildings', 'periods', 'users', 'factors'].includes(kind))
        fail(404, 'NOT_FOUND', 'Resource not found.');
    const name = kind === 'factors' ? null : text(body.name, 'name', 160);
    // Expensive password hashing is outside the database transaction.
    const pass = kind === 'users' ? await passwordHash(body.password) : null;
    return tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'create-' + kind, key, body, async () => {
        const rid = id();
        let row;
        if (kind === 'campuses')
            row = (await c.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4) RETURNING *', [rid, user.tenant_id, name, text(body.code, 'code', 30)])).rows[0];
        if (kind === 'buildings')
            row = (await c.query('INSERT INTO cs.buildings(id,tenant_id,campus_id,name) VALUES($1,$2,$3,$4) RETURNING *', [rid, user.tenant_id, uuid(body.campusId), name])).rows[0];
        if (kind === 'periods') {
            const start = day(body.startDate), end = day(body.endDate);
            if (start > end)
                fail(422, 'DATE_RANGE', 'End date must not be before start date.');
            row = (await c.query('INSERT INTO cs.periods(id,tenant_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING *', [rid, user.tenant_id, name, start, end])).rows[0];
        }
        if (kind === 'users') {
            if (!['ADMIN', 'ENTRY', 'REVIEWER', 'LEADERSHIP'].includes(body.role))
                fail(422, 'INVALID_ROLE', 'Select a supported role.');
            const email = text(body.email, 'email', 254).toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                fail(422, 'INVALID_EMAIL', 'Enter a valid email.');
            row = (await c.query('INSERT INTO cs.users(id,tenant_id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,tenant_id,name,email,role,active,created_at', [rid, user.tenant_id, name, email, body.role, pass])).rows[0];
        }
        if (kind === 'factors') {
            const category = text(body.category, 'category', 60), spec = CATEGORIES[category];
            if (!spec || body.unit !== spec[1])
                fail(422, 'UNIT_MISMATCH', 'Use a supported canonical unit.');
            let sourceUrl;
            try {
                sourceUrl = new URL(body.sourceUrl);
                if (sourceUrl.protocol !== 'https:')
                    throw Error();
            }
            catch {
                fail(422, 'SOURCE_REQUIRED', 'Provide the HTTPS source URL of your approved methodology.');
            }
            const from = day(body.validFrom), to = day(body.validTo);
            if (from > to)
                fail(422, 'DATE_RANGE', 'Invalid factor validity.');
            row = (await c.query(`INSERT INTO cs.factors(id,tenant_id,category,scope,unit,value,version_label,source,source_url,region,methodology,valid_from,valid_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [rid, user.tenant_id, category, spec[0], spec[1], decimal(body.value, 'factor', 9), text(body.versionLabel, 'versionLabel', 80), text(body.source, 'source', 500), sourceUrl.href, text(body.region, 'region', 100), text(body.methodology, 'methodology', 1000), from, to, user.id])).rows[0];
        }
        await audit(c, user, 'CREATED_' + kind.toUpperCase(), rid, kind === 'users' ? { role: row.role } : { name: row.name || row.version_label });
        return row;
    }));
}
export async function approveFactor(pool, user, factorId) {
    role(user, ['ADMIN', 'REVIEWER']);
    uuid(factorId);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const old = (await c.query('SELECT * FROM cs.factors WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, factorId])).rows[0];
        if (!old)
            fail(404, 'NOT_FOUND', 'Factor not found.');
        if (old.created_by === user.id)
            fail(403, 'SELF_APPROVAL', 'Another person must approve the factor.');
        if (old.status === 'APPROVED')
            return old;
        const row = (await c.query("UPDATE cs.factors SET status='APPROVED',approved_by=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *", [user.tenant_id, factorId, user.id])).rows[0];
        await audit(c, user, 'FACTOR_APPROVED', factorId, { version: row.version_label, source: row.source });
        return row;
    });
}
export async function setPeriod(pool, user, periodId, body, lock) {
    role(user, ['ADMIN']);
    uuid(periodId);
    const reason = text(body.reason, 'reason', 500);
    if (reason.length < 10)
        fail(422, 'REASON_REQUIRED', 'Explain the lock or reopening in at least 10 characters.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        const old = (await c.query('SELECT * FROM cs.periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, periodId])).rows[0];
        if (!old)
            fail(404, 'NOT_FOUND', 'Period not found.');
        version(old, body.version);
        if (lock) {
            const pending = (await c.query("SELECT 1 FROM cs.activities WHERE tenant_id=$1 AND period_id=$2 AND status NOT IN ('CALCULATED','REJECTED') LIMIT 1", [user.tenant_id, periodId])).rows;
            if (pending.length)
                fail(409, 'PENDING_ACTIVITIES', 'Resolve pending activities before locking the period.');
            const unresolved = (await c.query(`SELECT
                EXISTS(SELECT 1 FROM cs.u_tasks WHERE tenant_id=$1 AND period_id=$2 AND status='OPEN') AS tasks,
                EXISTS(SELECT 1 FROM cs.u_emissions WHERE tenant_id=$1 AND period_id=$2 AND status IN ('DRAFT','SUBMITTED')) AS emissions,
                EXISTS(SELECT 1 FROM cs.u_voids v JOIN cs.u_emissions e ON e.tenant_id=v.tenant_id AND e.id=v.emission_id WHERE v.tenant_id=$1 AND e.period_id=$2 AND v.status='SUBMITTED') AS voids`, [user.tenant_id, periodId])).rows[0];
            if (unresolved.tasks || unresolved.emissions || unresolved.voids)
                fail(409, 'PENDING_UNIVERSITY_DATA', 'Resolve open KPI tasks, pending university emissions and pending voids before locking.');
            const store=new UniversityStore(c,user);
            if(await store.count('u_c_period_modes',{period_id:periodId})){
                const carbon=await carbonReadiness(store,periodId);
                if(!carbon.ready)fail(409,'PENDING_SCOPE12_DATA','Resolve source gaps, drafts and high-severity findings before locking.',{blockers:carbon.blockers});
            }

        }
        const row = (await c.query('UPDATE cs.periods SET status=$3,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *', [user.tenant_id, periodId, lock ? 'LOCKED' : 'OPEN'])).rows[0];
        await audit(c, user, lock ? 'PERIOD_LOCKED' : 'PERIOD_REOPENED', periodId, { reason });
        return row;
    });
}
export async function updateUser(pool, user, targetId, body) {
    role(user, ['ADMIN']);
    uuid(targetId);
    if (!['ADMIN', 'ENTRY', 'REVIEWER', 'LEADERSHIP'].includes(body.role) || typeof body.active !== 'boolean')
        fail(422, 'INVALID_USER', 'role and active are required.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        await c.query('SELECT id FROM cs.tenants WHERE id=$1 FOR UPDATE', [user.tenant_id]);
        const old = (await c.query('SELECT id,role,active FROM cs.users WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, targetId])).rows[0];
        if (!old)
            fail(404, 'NOT_FOUND', 'User not found.');
        if (old.role === 'ADMIN' && old.active && (body.role !== 'ADMIN' || !body.active)) {
            const n = (await c.query("SELECT count(*) AS n FROM cs.users WHERE tenant_id=$1 AND role='ADMIN' AND active", [user.tenant_id])).rows[0];
            if (Number(n.n) <= 1)
                fail(409, 'LAST_ADMIN', 'At least one active administrator is required.');
        }
        await c.query('UPDATE cs.users SET role=$3,active=$4 WHERE tenant_id=$1 AND id=$2', [user.tenant_id, targetId, body.role, body.active]);
        await c.query('DELETE FROM cs.sessions WHERE tenant_id=$1 AND user_id=$2', [user.tenant_id, targetId]);
        await audit(c, user, 'USER_ACCESS_CHANGED', targetId, { before: old, after: { role: body.role, active: body.active } });
        return { id: targetId, role: body.role, active: body.active, sessionsRevoked: true };
    });
}
