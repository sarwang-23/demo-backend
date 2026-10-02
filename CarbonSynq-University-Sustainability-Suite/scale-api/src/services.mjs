import { dispatchOperations, publicAccount } from './operations/routes.mjs';
import { operationsConfig } from './operations/crypto.mjs';
import { dispatch as universityDispatch, portalDispatch } from './university/router.mjs';
import * as auth from './auth.mjs';
import * as management from './management.mjs';
import * as activities from './activities.mjs';
import * as documents from './documents.mjs';
import * as reports from './reporting.mjs';
import { retryJob } from './jobs.mjs';
import { role, WRITERS } from './core.mjs';
export function services(pool, storage, config) {
    const api = {};
    const ops=operationsConfig();
    let readinessPromise = null, readinessAt = 0;
    for (const module of [management, activities, reports])
        for (const [name, fn] of Object.entries(module))
            api[name] = (...args) => fn(pool, ...args);
    Object.assign(api, {
        operations: request => dispatchOperations(pool,request,{cfg:ops,storage}),
        account: request => publicAccount(pool,request,ops),
        university: (request) => universityDispatch(pool, request),
        universityPortal: (request) => portalDispatch(pool, request),
        publicUser: auth.publicUser, login: (body, ip) => auth.login(pool, body, ip, config.sessionHours), authenticate: h => auth.authenticate(pool, h), logout: u => auth.logout(pool, u), changePassword: (u, b) => auth.changePassword(pool, u, b),
        async limit(u) { await auth.rateLimit(pool, 'api-user:' + u.tenant_id + ':' + u.id, 300, 60); await auth.rateLimit(pool, 'api-tenant:' + u.tenant_id, 3000, 60); },
        async uploadLimit(u) { role(u, WRITERS); await auth.rateLimit(pool, 'upload:' + u.tenant_id, 60, 60); },
        upload: (u, name, mime, bytes, key) => documents.upload(pool, storage, u, name, mime, bytes, key, config.maxUploadBytes),
        getDocument: (u, id) => documents.getDocument(pool, u, id), download: (u, id) => documents.download(pool, storage, u, id), retryUpload: (u, id, bytes, mime, name) => documents.retryUpload(pool, storage, u, id, bytes, mime, name, config.maxUploadBytes),
        retryJob: (u, id, b) => retryJob(pool, u, id, b),
        async readiness() {
            if (readinessPromise && Date.now() - readinessAt < 5000)
                return readinessPromise;
            readinessAt = Date.now();
            readinessPromise = (async () => {
                let database = false, storageReady = false, worker = false;
                try {
                    const r = await pool.query("SELECT EXISTS(SELECT 1 FROM cs.worker_heartbeats WHERE updated_at>now()-interval '120 seconds') AS worker");
                    database = true;
                    worker = r.rows[0].worker;
                }
                catch { }
                try {
                    storageReady = await storage.check();
                }
                catch { }
                return { ready: database && storageReady && worker, checks: { database, versionedStorage: storageReady, worker }, note: 'Worker heartbeat does not prove malware signatures are current; alert on scan failures and signature age.' };
            })();
            return readinessPromise;
        }
    });
    return api;
}
