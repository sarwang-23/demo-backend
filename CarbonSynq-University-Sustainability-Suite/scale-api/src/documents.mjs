import { assertEvidenceAccess } from './operations/access.mjs';
import { id, uuid, role, WRITERS, fail, hash } from './core.mjs';
import { tenantTx, idempotent, audit, enqueue } from './db.mjs';
import { validateUpload } from './storage.mjs';
export function publicDocument(d) {
    const { object_key, object_version, upload_deadline, quota_reserved, ...safe } = d;
    return safe;
}
export async function upload(pool, storage, user, filename, mime, bytes, key, maxBytes = 10485760) {
    role(user, WRITERS);
    const f = validateUpload(filename, mime, bytes, maxBytes);
    const candidate = id();
    // Reserve quota and document before external I/O. An upload is a durable two-phase operation.
    const reservation = await tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'documents.upload', key, f, async () => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.tenant_id + ':file:' + f.sha256]);
        const existing = (await c.query('SELECT id,status FROM cs.documents WHERE tenant_id=$1 AND sha256=$2', [user.tenant_id, f.sha256])).rows[0];
        if (existing)
            fail(409, 'DUPLICATE_FILE', 'This file already exists in your university. Ask an administrator to resolve authorized access.');
        const quota = await c.query(`UPDATE cs.tenants SET storage_used_bytes=storage_used_bytes+$2 WHERE id=$1 AND status='ACTIVE' AND storage_used_bytes+$2<=storage_quota_bytes RETURNING id`, [user.tenant_id, f.size]);
        if (!quota.rowCount)
            fail(409, 'STORAGE_QUOTA', 'Storage quota exceeded or tenant suspended.');
        await c.query(`INSERT INTO cs.documents(id,tenant_id,original_name,mime_type,file_size,sha256,object_key,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [candidate, user.tenant_id, f.name, f.mime, f.size, f.sha256, `${user.tenant_id}/evidence/${candidate}`, user.id]);
        await enqueue(c, user.tenant_id, 'RECONCILE_UPLOAD', candidate, 300);
        await audit(c, user, 'UPLOAD_RESERVED', candidate, { sha256: f.sha256, bytes: f.size });
        return { id: candidate };
    }));
    // A retry returns the existing operation; it never races a second PUT against the first PUT.
    if (reservation.id !== candidate)
        return getDocument(pool, user, reservation.id);
    let stored;
    try {
        stored = await storage.put(`${user.tenant_id}/evidence/${candidate}`, bytes, f.mime);
    }
    catch (error) {
        // Keep UPLOADING: a timeout does not prove that S3 failed to persist the object.
        // Maintenance reconciles the exact key and digest instead of deleting on an ambiguous failure.
        throw Object.assign(new Error('S3 upload outcome uncertain'), { code: 'STORAGE_UNCERTAIN', cause: error, documentId: candidate });
    }
    return tenantTx(pool, user.tenant_id, async (c) => {
        const doc = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, candidate])).rows[0];
        if (doc.status !== 'UPLOADING')
            fail(409, 'UPLOAD_EXPIRED', 'Upload reservation is no longer active. Ask an administrator to retry it.');
        const row = (await c.query("UPDATE cs.documents SET status='QUEUED',object_version=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [user.tenant_id, candidate, stored.versionId])).rows[0];
        await enqueue(c, user.tenant_id, 'SCAN_INVOICE', candidate);
        await audit(c, user, 'UPLOAD_COMPLETED', candidate, { versionPinned: true });
        return publicDocument(row);
    });
}
export async function getDocument(pool, user, documentId) {
    uuid(documentId);
    return tenantTx(pool, user.tenant_id, async (c) => { const d = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2', [user.tenant_id, documentId])).rows[0]; if (!d)
        fail(404, 'NOT_FOUND', 'Document not found.'); await assertEvidenceAccess(c,user,d); return publicDocument(d); });
}
export async function download(pool, storage, user, documentId) {
    uuid(documentId);
    const d = await tenantTx(pool, user.tenant_id, async (c) => {
        const doc = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2', [user.tenant_id, documentId])).rows[0];
        if (!doc)
            fail(404, 'NOT_FOUND', 'Document not found.');
        await assertEvidenceAccess(c,user,doc);
        if (!['REVIEW_REQUIRED', 'LINKED'].includes(doc.status) || doc.scan_result !== 'CLEAN')
            fail(409, 'QUARANTINED', 'This invoice has not passed the malware scan.');
        return doc;
    });
    const bytes = await storage.get(d.object_key, d.object_version, Number(d.file_size));
    if (bytes.length !== Number(d.file_size) || hash(bytes) !== d.sha256)
        fail(503, 'EVIDENCE_INTEGRITY', 'Stored evidence did not match its recorded digest.');
    await tenantTx(pool, user.tenant_id, c => audit(c, user, 'EVIDENCE_DOWNLOADED', documentId, { sha256: d.sha256 }));
    return { bytes, name: d.original_name, mime: d.mime_type };
}
export async function retryUpload(pool, storage, user, documentId, bytes, mime, filename, maxBytes) {
    role(user, ['ADMIN']);
    uuid(documentId);
    const f = validateUpload(filename, mime, bytes, maxBytes);
    // No blind overwrite of an active or accepted evidence object.
    const doc = await tenantTx(pool, user.tenant_id, async (c) => {
        const d = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, documentId])).rows[0];
        if (!d)
            fail(404, 'NOT_FOUND', 'Document not found.');
        if (d.status !== 'UPLOAD_FAILED')
            fail(409, 'INVALID_STATE', 'Only reconciled failed uploads can be retried.');
        if (f.sha256 !== d.sha256 || f.mime !== d.mime_type)
            fail(422, 'DIGEST_MISMATCH', 'Retry with the exact original file.');
        const q = await c.query('UPDATE cs.tenants SET storage_used_bytes=storage_used_bytes+$2 WHERE id=$1 AND storage_used_bytes+$2<=storage_quota_bytes RETURNING id', [user.tenant_id, f.size]);
        if (!q.rowCount)
            fail(409, 'STORAGE_QUOTA', 'Storage quota exceeded.');
        const freshKey = `${user.tenant_id}/evidence/${id()}`;
        await c.query("UPDATE cs.documents SET status='UPLOADING',object_key=$3,object_version=NULL,quota_reserved=true,upload_deadline=now()+interval '5 minutes',version=version+1 WHERE tenant_id=$1 AND id=$2", [user.tenant_id, documentId, freshKey]);
        await enqueue(c, user.tenant_id, 'RECONCILE_UPLOAD', documentId, 300, freshKey);
        await audit(c, user, 'UPLOAD_RETRIED', documentId);
        return { ...d, object_key: freshKey };
    });
    const stored = await storage.put(doc.object_key, bytes, doc.mime_type);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const r = (await c.query("UPDATE cs.documents SET object_version=$3,status='QUEUED',version=version+1 WHERE tenant_id=$1 AND id=$2 AND status='UPLOADING' AND object_key=$4 RETURNING *", [user.tenant_id, documentId, stored.versionId, doc.object_key])).rows[0];
        if (!r)
            fail(409, 'UPLOAD_EXPIRED', 'Upload reservation changed.');
        await enqueue(c, user.tenant_id, 'SCAN_INVOICE', documentId);
        return publicDocument(r);
    });
}
