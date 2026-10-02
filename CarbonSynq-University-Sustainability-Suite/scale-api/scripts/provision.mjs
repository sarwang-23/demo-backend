import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { id, text, passwordHash, day } from '../src/core.mjs';
const name = text(process.env.TENANT_NAME || 'Your University', 'TENANT_NAME', 160);
const email = text(process.env.ADMIN_EMAIL || 'admin@university.example', 'ADMIN_EMAIL', 254).toLowerCase();
const reviewerEmail = text(process.env.REVIEWER_EMAIL || 'reviewer@university.example', 'REVIEWER_EMAIL', 254).toLowerCase();
if (email === reviewerEmail)
    throw Error('Admin and reviewer must be different people.');
if (process.env.NODE_ENV === 'production' && (!process.env.TENANT_NAME || !process.env.ADMIN_EMAIL || !process.env.REVIEWER_EMAIL))
    throw Error('Production provisioning requires explicit tenant name and real admin/reviewer email addresses.');
const adminPassword = process.env.ADMIN_PASSWORD || randomBytes(24).toString('base64url'), reviewerPassword = process.env.REVIEWER_PASSWORD || randomBytes(24).toString('base64url');
const hashes = await Promise.all([passwordHash(adminPassword), passwordHash(reviewerPassword)]);
const { Client } = await import('pg');
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: true, ...(process.env.DB_CA_FILE ? { ca: await readFile(process.env.DB_CA_FILE, 'utf8') } : {}) } : false;
if (process.env.NODE_ENV === 'production' && !ssl)
    throw Error('Production provisioning requires DB_SSL=true.');
if (!process.env.DATABASE_OWNER_URL)
    throw Error('DATABASE_OWNER_URL is required for operator provisioning.');
const ownerUrl = new URL(process.env.DATABASE_OWNER_URL);
for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    if (ownerUrl.searchParams.has(key))
        throw Error('Use DB_SSL/DB_CA_FILE instead of database URL SSL parameters.');
const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL, ssl, enableChannelBinding: process.env.DB_CHANNEL_BINDING === 'true' });
await client.connect();
const tenant = id(), admin = id(), reviewer = id(), campus = id(), building = id(), period = id();
const today = new Date(), year = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
const start = day(process.env.PERIOD_START || `${year}-04-01`), end = day(process.env.PERIOD_END || `${year + 1}-03-31`);
try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await client.query('INSERT INTO cs.tenants(id,name) VALUES($1,$2)', [tenant, name]);
    for (const [uid, mail, person, role, pass] of [[admin, email, 'University Administrator', 'ADMIN', hashes[0]], [reviewer, reviewerEmail, 'Sustainability Reviewer', 'REVIEWER', hashes[1]]])
        await client.query('INSERT INTO cs.users(id,tenant_id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)', [uid, tenant, mail, person, role, pass]);
    await client.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4)', [campus, tenant, 'Main Campus', 'MAIN']);
    await client.query('INSERT INTO cs.buildings(id,tenant_id,campus_id,name) VALUES($1,$2,$3,$4)', [building, tenant, campus, 'Administration']);
    await client.query('INSERT INTO cs.periods(id,tenant_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5)', [period, tenant, `FY ${year}-${year + 1}`, start, end]);
    await client.query('INSERT INTO cs.audit_events(tenant_id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$1,$4)', [tenant, admin, 'TENANT_PROVISIONED', JSON.stringify({ via: 'owner CLI', syntheticEmissionFactors: false })]);
    await client.query('COMMIT');
    // A fresh tenant is deliberately empty of activities and factors. These are local delivery credentials, not emailed.
    console.log(JSON.stringify({ tenantId: tenant, tenantName: name, admin: { email, password: adminPassword }, reviewer: { email: reviewerEmail, password: reviewerPassword }, campusId: campus, buildingId: building, periodId: period, note: 'Store these credentials securely; change them after first login. No emission factors were seeded.' }, null, 2));
}
catch (e) {
    await client.query('ROLLBACK');
    throw e;
}
finally {
    await client.end();
}
