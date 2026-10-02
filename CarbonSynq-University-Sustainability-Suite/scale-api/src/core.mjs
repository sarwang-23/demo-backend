import { randomUUID, createHash, randomBytes, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(rawScrypt);
export const id = randomUUID;
export const hash = x => createHash('sha256').update(x).digest('hex');
export class AppError extends Error {
    constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); }
}
export function fail(status, code, message, details) { throw new AppError(status, code, message, details); }
export function object(x) { if (!x || typeof x !== 'object' || Array.isArray(x))
    fail(422, 'INVALID_OBJECT', 'Expected a JSON object.'); return x; }
export function text(x, name, max = 200, optional = false) {
    if (optional && (x === undefined || x === null || x === ''))
        return null;
    if (typeof x !== 'string' || !x.trim() || x.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x))
        fail(422, 'INVALID_FIELD', `${name} is required and must be at most ${max} characters.`);
    return x.trim();
}
export function uuid(x, name = 'id') { if (typeof x !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x))
    fail(422, 'INVALID_ID', `${name} must be a UUID.`); return x.toLowerCase(); }
export function day(x, name = 'date') {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(Date.parse(x)) || new Date(x).toISOString().slice(0, 10) !== x)
        fail(422, 'INVALID_DATE', `${name} must be a real YYYY-MM-DD date.`);
    return x;
}
// All quantities, factors and totals travel as decimal strings. No floating point arithmetic.
export function decimal(x, name = 'quantity', precision = 6, allowZero = false) {
    if (typeof x !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,${precision}})?$`).test(x))
        fail(422, 'INVALID_DECIMAL', `${name} must be a decimal STRING, at most 12 integer digits and ${precision} fractional digits.`);
    const [a, b = ''] = x.split('.');
    if (!allowZero && BigInt(a + b.padEnd(precision, '0')) === 0n)
        fail(422, 'INVALID_DECIMAL', `${name} must be positive.`);
    return a + '.' + b.padEnd(precision, '0');
}
export function multiplyDecimals(quantity, factor) {
    const q = decimal(quantity, 'quantity', 6).replace('.', '');
    const f = decimal(factor, 'factor', 9).replace('.', '');
    const product = BigInt(q) * BigInt(f); // 15 fractional digits, rounded half-up to 6.
    const rounded = (product + 500000000n) / 1000000000n;
    const s = rounded.toString().padStart(7, '0');
    return s.slice(0, -6) + '.' + s.slice(-6);
}
export function canonical(x) {
    if (Array.isArray(x))
        return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object')
        return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
    return JSON.stringify(x);
}
export function role(user, allowed) { if (!allowed.includes(user.role))
    fail(403, 'FORBIDDEN', 'Your role cannot perform this action.'); }
export const WRITERS = ['ADMIN', 'ENTRY'];
export const REVIEWERS = ['ADMIN', 'REVIEWER'];
export const CATEGORIES = Object.freeze({ PURCHASED_ELECTRICITY: ['SCOPE_2', 'kWh'], DIESEL: ['SCOPE_1', 'litre'], PETROL: ['SCOPE_1', 'litre'], LPG: ['SCOPE_1', 'kg'], NATURAL_GAS: ['SCOPE_1', 'm3'] });
export function activityInput(x) {
    object(x);
    if ('tenantId' in x || 'universityId' in x || 'scope' in x)
        fail(422, 'SERVER_OWNED_FIELD', 'Tenant and scope are determined by the server.');
    const category = text(x.category, 'category', 60);
    const spec = CATEGORIES[category];
    if (!spec || x.unit !== spec[1])
        fail(422, 'UNIT_MISMATCH', 'Use the canonical unit for a supported category.');
    const a = { periodId: uuid(x.periodId, 'periodId'), campusId: uuid(x.campusId, 'campusId'), buildingId: x.buildingId ? uuid(x.buildingId, 'buildingId') : null,
        category, scope: spec[0], unit: spec[1], quantity: decimal(x.quantity), activityDate: day(x.activityDate), description: text(x.description, 'description', 2000, true) || '',
        duplicateReason: text(x.duplicateReason, 'duplicateReason', 500, true) };
    if (a.duplicateReason && a.duplicateReason.length < 10)
        fail(422, 'DUPLICATE_REASON', 'Explain the separate consumption record in at least 10 characters.');
    return a;
}
export function fingerprint(a) { return hash(canonical([a.periodId, a.campusId, a.buildingId, a.category, a.unit, a.quantity, a.activityDate])); }
export function version(row, x) { if (!Number.isInteger(x) || x !== row.version)
    fail(409, 'STALE_VERSION', 'Refresh this record and retry with its current version.'); }
export function workflow(row, action, user, body) {
    version(row, body.version);
    if (action === 'submit') {
        role(user, WRITERS);
        if (user.role !== 'ADMIN' && row.created_by !== user.id)
            fail(403, 'NOT_OWNER', 'Only the owner or admin may submit.');
    }
    else
        role(user, REVIEWERS);
    const next = { submit: ['DRAFT', 'SUBMITTED'], 'start-review': ['SUBMITTED', 'UNDER_REVIEW'], verify: ['UNDER_REVIEW', 'VERIFIED'] }[action];
    if (action === 'reject') {
        if (!['SUBMITTED', 'UNDER_REVIEW'].includes(row.status))
            fail(409, 'INVALID_STATE', 'Only pending review records can be rejected.');
        const reason = text(body.reason, 'reason', 1000);
        if (reason.length < 5)
            fail(422, 'REASON_REQUIRED', 'Provide a useful rejection reason.');
        return { status: 'REJECTED', reason };
    }
    if (!next || row.status !== next[0])
        fail(409, 'INVALID_STATE', 'This transition is not valid for the current status.');
    if (action === 'verify' && row.created_by === user.id)
        fail(403, 'SELF_APPROVAL', 'A different person must approve this activity.');
    return { status: next[1], reason: null };
}
export function pagination(query) {
    const limit = Number(query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(422, 'INVALID_LIMIT', 'limit must be 1 to 100.');
    let cursor = null;
    if (query.cursor) {
        try {
            cursor = JSON.parse(Buffer.from(text(query.cursor, 'cursor', 512), 'base64url').toString());
            day(cursor[0].slice(0, 10));
            uuid(cursor[1]);
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor[0]))
                throw Error();
        }
        catch {
            fail(422, 'INVALID_CURSOR', 'Invalid pagination cursor.');
        }
    }
    return { limit, cursor };
}
export function page(rows, limit) { const more = rows.length > limit; const items = rows.slice(0, limit); const last = items.at(-1); return { items, nextCursor: more ? Buffer.from(JSON.stringify([new Date(last.created_at).toISOString(), last.id])).toString('base64url') : null }; }
export async function passwordHash(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128)
        fail(422, 'PASSWORD_POLICY', 'Use a password of 12 to 128 characters.');
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function passwordVerify(password, encoded) {
    const [, salt, key] = String(encoded).split('$');
    if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(key || '') || typeof password !== 'string' || password.length > 128)
        return false;
    const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(Buffer.from(key, 'hex'), actual);
}
export function sessionToken(tenantId) { return `${uuid(tenantId)}.${randomBytes(32).toString('base64url')}`; }
export function parseToken(header) {
    const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header || '');
    if (!match)
        fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    try {
        return { tenantId: uuid(match[1]), tokenHash: hash(match[1] + '.' + match[2]) };
    }
    catch {
        fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
}
export function idempotencyKey(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value))
    fail(422, 'IDEMPOTENCY_REQUIRED', 'Send an Idempotency-Key of 8 to 128 safe characters.'); return value; }
export function errorResponse(error, requestId) {
    if (error instanceof AppError)
        return { status: error.status, body: { success: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, requestId } };
    const known = { 'STORAGE_UNCERTAIN': [503, 'UPLOAD_PENDING', 'The upload outcome is pending. Retry the same request and key; do not create a new upload.'], '40001': [409, 'RETRY_TRANSACTION', 'Concurrent change. Retry safely with the same idempotency key.'], '40P01': [409, 'RETRY_TRANSACTION', 'Concurrent change. Retry safely with the same idempotency key.'], '23505': [409, 'CONFLICT', 'A matching record already exists.'], '23503': [422, 'INVALID_REFERENCE', 'A referenced record is not valid.'], '23514': [422, 'CONSTRAINT', 'A data constraint was not satisfied.'], '42501': [403, 'FORBIDDEN', 'Operation is not authorized.'], '57014': [503, 'BUSY', 'The request timed out. Retry safely using the same idempotency key.'], '55P03': [503, 'BUSY', 'The record is busy. Retry shortly.'] };
    const k = known[error?.code] || [500, 'INTERNAL_ERROR', 'Request failed. Use the request ID when contacting support.'];
    return { status: k[0], body: { success: false, error: { code: k[1], message: k[2] }, requestId } };
}
