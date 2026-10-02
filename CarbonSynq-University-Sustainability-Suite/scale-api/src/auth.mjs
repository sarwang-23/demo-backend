import { hash, uuid, text, fail, passwordVerify, passwordHash, sessionToken, parseToken } from './core.mjs';
import { tenantTx, audit, enqueue } from './db.mjs';
const DUMMY = 'scrypt$' + '0'.repeat(32) + '$' + '0'.repeat(128);
export async function rateLimit(pool, key, max, seconds) {
    const r = (await pool.query(`INSERT INTO cs.rate_buckets(bucket_key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(bucket_key) DO UPDATE SET hits=CASE WHEN cs.rate_buckets.expires_at<=now() THEN 1 ELSE cs.rate_buckets.hits+1 END,
    expires_at=CASE WHEN cs.rate_buckets.expires_at<=now() THEN now()+$2*interval '1 second' ELSE cs.rate_buckets.expires_at END RETURNING hits`, [hash(key), seconds])).rows[0];
    if (r.hits > max)
        fail(429, 'RATE_LIMITED', 'Too many requests. Retry after the rate window.');
}
export async function login(pool, body, ip, sessionHours = 8) {
    await rateLimit(pool, 'login-ip:' + ip, 30, 900);
    const tenantId = uuid(body.tenantId, 'tenantId');
    const email = text(body.email, 'email', 254).toLowerCase();
    await rateLimit(pool, `login-account:${tenantId}:${email}`, 10, 900);
    const row = await tenantTx(pool, tenantId, async (c) => (await c.query(`SELECT u.*,t.status AS tenant_status FROM cs.users u JOIN cs.tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.email=$2`, [tenantId, email])).rows[0]);
    const ok = await passwordVerify(body.password, row?.password_hash || DUMMY);
    if (!ok || !row?.active || row.tenant_status !== 'ACTIVE')
        fail(401, 'INVALID_CREDENTIALS', 'Tenant, email or password is incorrect.');
    const token = sessionToken(tenantId);
    await tenantTx(pool, tenantId, async (c) => {
        // Prevent a login racing password reset or account suspension from minting a valid session.
        const current = (await c.query('SELECT u.*,t.status AS tenant_status FROM cs.users u JOIN cs.tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.id=$2 FOR SHARE OF u,t', [tenantId, row.id])).rows[0];
        if (!current?.active || current.tenant_status !== 'ACTIVE' || current.password_hash !== row.password_hash)
            fail(401, 'INVALID_CREDENTIALS', 'Account changed. Sign in again.');
        await c.query(`INSERT INTO cs.sessions(tenant_id,token_hash,user_id,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 hour')`, [tenantId, hash(token), row.id, sessionHours]);
        await audit(c, row, 'LOGIN', row.id);
        await enqueue(c,tenantId,'OPS_SWEEP',tenantId);
    });
    return { token, expiresInSeconds: sessionHours * 3600, user: publicUser(row) };
}
export function publicUser(r) { return { id: r.id, tenantId: r.tenant_id, name: r.name, email: r.email, role: r.role }; }
export async function authenticate(pool, header) {
    const { tenantId, tokenHash } = parseToken(header);
    const user = await tenantTx(pool, tenantId, async (c) => (await c.query(`SELECT u.* FROM cs.sessions s JOIN cs.users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id JOIN cs.tenants t ON t.id=u.tenant_id WHERE s.tenant_id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND u.active AND t.status='ACTIVE'`, [tenantId, tokenHash])).rows[0]);
    if (!user)
        fail(401, 'UNAUTHENTICATED', 'Session expired or revoked. Sign in again.');
    delete user.password_hash;
    user.tokenHash = tokenHash;
    return user;
}
export async function logout(pool, user) {
    return tenantTx(pool, user.tenant_id, async (c) => { await c.query('DELETE FROM cs.sessions WHERE tenant_id=$1 AND token_hash=$2', [user.tenant_id, user.tokenHash]); await audit(c, user, 'LOGOUT', user.id); return { loggedOut: true }; });
}
export async function changePassword(pool, user, body) {
    const old = await tenantTx(pool, user.tenant_id, async (c) => (await c.query('SELECT password_hash FROM cs.users WHERE tenant_id=$1 AND id=$2', [user.tenant_id, user.id])).rows[0]);
    if (!await passwordVerify(body.currentPassword, old?.password_hash))
        fail(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    const encoded = await passwordHash(body.newPassword);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const changed = await c.query('UPDATE cs.users SET password_hash=$1,password_version=password_version+1 WHERE tenant_id=$2 AND id=$3 AND password_hash=$4 RETURNING id', [encoded, user.tenant_id, user.id, old.password_hash]);
        if (!changed.rowCount)
            fail(409, 'ACCOUNT_CHANGED', 'Account changed. Sign in again.');
        await c.query('DELETE FROM cs.sessions WHERE tenant_id=$1 AND user_id=$2', [user.tenant_id, user.id]);
        await audit(c, user, 'PASSWORD_CHANGED', user.id);
        return { sessionsRevoked: true };
    });
}
