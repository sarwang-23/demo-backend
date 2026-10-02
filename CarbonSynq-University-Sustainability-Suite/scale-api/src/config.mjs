import { readFileSync } from 'node:fs';
export function config(env = process.env, worker = false) {
    const required = k => { if (!env[k])
        throw Error(`${k} is required. Run npm run setup for local infrastructure, or supply managed-service settings.`); return env[k]; };
    const integer = (k, d, min, max) => { const n = Number(env[k] ?? d); if (!Number.isInteger(n) || n < min || n > max)
        throw Error(`${k} must be ${min}..${max}`); return n; };
    const production = env.NODE_ENV === 'production';
    const databaseUrl = required(worker ? 'WORKER_DATABASE_URL' : 'DATABASE_URL');
    const dbURL = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(dbURL.protocol))
        throw Error('A PostgreSQL URL is required.');
    // URL sslmode parameters can override explicit pg SSL objects: do not permit that ambiguity.
    for (const k of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
        if (dbURL.searchParams.has(k))
            throw Error(`Remove ${k} from DATABASE_URL; use DB_SSL/DB_CA_FILE instead.`);
    if (env.DB_CHANNEL_BINDING && !['true', 'false'].includes(env.DB_CHANNEL_BINDING))
        throw Error('DB_CHANNEL_BINDING must be true or false.');
    if (env.DB_CHANNEL_BINDING === 'true' && env.DB_SSL !== 'true')
        throw Error('DB_CHANNEL_BINDING requires DB_SSL=true.');
    const ssl = env.DB_SSL === 'true' ? { rejectUnauthorized: true, ...(env.DB_CA_FILE ? { ca: readFileSync(env.DB_CA_FILE, 'utf8') } : {}) } : false;
    if (production && !ssl)
        throw Error('Production requires DB_SSL=true with verified certificates.');
    const origins = worker ? [] : required('ALLOWED_ORIGINS').split(',').map(s => s.trim());
    for (const origin of origins) {
        const u = new URL(origin);
        if (u.origin !== origin || !['http:', 'https:'].includes(u.protocol))
            throw Error('Origins must be exact http(s) origins without paths.');
        if (production && u.protocol !== 'https:')
            throw Error('Production origins must use HTTPS.');
    }
    const endpoint = env.S3_ENDPOINT || undefined;
    if (production && endpoint && !endpoint.startsWith('https://'))
        throw Error('Production S3 endpoint requires HTTPS.');
    if (!worker && required('REQUEST_HASH_SECRET').length < 32)
        throw Error('REQUEST_HASH_SECRET must be at least 32 characters.');
    const metricsToken = worker ? '' : required('METRICS_TOKEN');
    if (!worker && metricsToken.length < 32)
        throw Error('METRICS_TOKEN must have at least 32 characters.');
    return { production, databaseUrl, ssl, enableChannelBinding: env.DB_CHANNEL_BINDING === 'true', poolMax: integer('DB_POOL_MAX', 10, 1, 50), host: env.HOST || '127.0.0.1', port: integer('PORT', 8080, 1024, 65535), origins, metricsToken,
        maxUploadBytes: integer('MAX_UPLOAD_BYTES', 10485760, 1024, 10485760), maxInflight: integer('MAX_INFLIGHT_REQUESTS', 64, 1, 512), maxUploads: integer('MAX_INFLIGHT_UPLOADS', 4, 1, 16),
        bucket: required('S3_BUCKET'), region: env.AWS_REGION || 'us-east-1', endpoint, forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
        clamHost: env.CLAMAV_HOST || '127.0.0.1', clamPort: integer('CLAMAV_PORT', 3310, 1, 65535), workerPollMs: integer('WORKER_POLL_MS', 1000, 100, 60000),
        leaseSeconds: integer('JOB_LEASE_SECONDS', 180, 120, 900), scanTimeoutMs: integer('SCAN_TIMEOUT_MS', 45000, 1000, 60000),
        trustProxy: env.TRUST_PROXY === 'true', sessionHours: integer('SESSION_HOURS', 8, 1, 24) };
}
