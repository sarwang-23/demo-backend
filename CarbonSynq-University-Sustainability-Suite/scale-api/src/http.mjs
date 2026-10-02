import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import { id, object, fail, errorResponse, hash } from './core.mjs';
import { Metrics } from './metrics.mjs';
export async function readBody(req, max) {
    if (Number(req.headers['content-length'] || 0) > max)
        fail(413, 'PAYLOAD_TOO_LARGE', 'Request exceeds the size limit.');
    const chunks = [];
    let n = 0;
    for await (const chunk of req) {
        n += chunk.length;
        if (n > max)
            fail(413, 'PAYLOAD_TOO_LARGE', 'Request exceeds the size limit.');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}
async function jsonBody(req) {
    if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json')
        fail(415, 'CONTENT_TYPE', 'Use Content-Type: application/json.');
    const bytes = await readBody(req, 65536);
    try {
        return object(JSON.parse(bytes.toString('utf8')));
    }
    catch (e) {
        if (e.status)
            throw e;
        fail(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
    }
}
const STATIC = { '/operations':['operations/index.html','text/html; charset=utf-8'], '/operations/app.js':['operations/app.js','text/javascript; charset=utf-8'], '/operations/style.css':['operations/style.css','text/css; charset=utf-8'], '/account':['operations/account.html','text/html; charset=utf-8'], '/operations/account.js':['operations/account.js','text/javascript; charset=utf-8'], '/university/imports': ['ingestion/index.html', 'text/html; charset=utf-8'], '/ingestion/app.js': ['ingestion/app.js', 'text/javascript; charset=utf-8'], '/ingestion/style.css': ['ingestion/style.css', 'text/css; charset=utf-8'], '/university': ['university/index.html', 'text/html; charset=utf-8'], '/university/app.js': ['university/app.js', 'text/javascript; charset=utf-8'], '/university/style.css': ['university/style.css', 'text/css; charset=utf-8'], '/university/portal': ['university/portal.html', 'text/html; charset=utf-8'], '/university/portal.js': ['university/portal.js', 'text/javascript; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
export function createApp(config, services, { log = entry => console.log(JSON.stringify(entry)), metrics = new Metrics() } = {}) {
    let uploads = 0, auths = 0, draining = false;
    const server = createServer(async (req, res) => {
        const started = process.hrtime.bigint(), requestId = id();
        let counted = false, uploadSlot = false, authSlot = false, finished = false;
        res.setHeader('X-Request-Id', requestId);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        if (config.production)
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        const complete = () => { if (finished)
            return; finished = true; if (counted)
            metrics.active--; if (uploadSlot)
            uploads--; if (authSlot)
            auths--; const elapsed = Number(process.hrtime.bigint() - started) / 1e9; metrics.observe(res.statusCode, elapsed); log({ event: 'http', requestId, method: req.method, status: res.statusCode, durationMs: Math.round(elapsed * 1000) }); };
        res.once('finish', complete);
        res.once('close', complete);
        const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ success: true, data, requestId })); };
        try {
            if (draining)
                fail(503, 'DRAINING', 'Server is restarting. Retry shortly.');
            if (metrics.active >= config.maxInflight)
                fail(503, 'OVERLOADED', 'Server is busy. Retry shortly.');
            metrics.active++;
            counted = true;
            const origin = req.headers.origin;
            if (origin && !config.origins.includes(origin))
                fail(403, 'ORIGIN_DENIED', 'This browser origin is not allowed.');
            if (origin) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
                res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,X-Filename');
                res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
                res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
            }
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            const url = new URL(req.url, 'http://request.invalid'), path = url.pathname, method = req.method, query = Object.fromEntries(url.searchParams);
            if (method === 'GET' && STATIC[path]) {
                const [file, mime] = STATIC[path];
                res.writeHead(200, { 'Content-Type': mime });
                res.end(await readFile(new URL('../public/' + file, import.meta.url)));
                return;
            }
            if (method === 'GET' && path === '/operations/openapi.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(await readFile(new URL('../docs/operations/openapi.json', import.meta.url))); return; }
            if (method === 'GET' && path === '/university/openapi.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(await readFile(new URL('../docs/university/openapi.json', import.meta.url)));
                return;
            }
            if (method === 'GET' && path === '/openapi.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(await readFile(new URL('../docs/openapi.json', import.meta.url)));
                return;
            }
            if (method === 'GET' && path === '/healthz') {
                send({ status: 'alive', service: 'carbonsynq-scale-api' });
                return;
            }
            if (method === 'GET' && path === '/readyz') {
                const r = await services.readiness();
                send(r, r.ready ? 200 : 503);
                return;
            }
            if (method === 'GET' && path === '/metrics') {
                const expected = Buffer.from(hash('Bearer ' + config.metricsToken)), actual = Buffer.from(hash(req.headers.authorization || ''));
                if (!timingSafeEqual(actual, expected))
                    fail(401, 'UNAUTHENTICATED', 'Metrics credential required.');
                res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
                res.end(metrics.render());
                return;
            }
            if (method === 'POST' && path === '/api/v2/auth/login') {
                if (auths >= 4)
                    fail(429, 'AUTH_BUSY', 'Sign-in service is busy. Retry shortly.');
                auths++;
                authSlot = true;
                const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',').at(-1).trim() : req.socket.remoteAddress || 'unknown';
                send(await services.login(await jsonBody(req), ip));
                return;
            }
            if (method === 'POST' && ['/api/v2/account/recover','/api/v2/account/complete'].includes(path)) {
                if (auths >= 4) fail(429,'AUTH_BUSY','Account service is busy. Retry shortly.');
                if (Object.keys(query).length) fail(422,'TOKEN_IN_BODY_ONLY','Credential tokens belong in the JSON body, never a query string.');
                auths++; authSlot=true;
                const ip=config.trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',').at(-1).trim():req.socket.remoteAddress||'unknown';
                send(await services.account({path,body:await jsonBody(req),ip,requestId})); return;
            }
            if ((method === 'GET' && path === '/api/v2/university/portal') || (method === 'POST' && path === '/api/v2/university/portal/submit')) {
                if (Object.keys(query).length) fail(422, 'TOKEN_IN_HEADER_ONLY', 'Invitation tokens belong in the Authorization header, never in a URL.');
                const ip = config.trustProxy ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',').at(-1).trim() : req.socket.remoteAddress || 'unknown';
                send(await services.universityPortal({ header: req.headers.authorization, body: method === 'POST' ? await jsonBody(req) : null, ip, requestId }));
                return;
            }
            if (!path.startsWith('/api/v2/'))
                fail(404, 'NOT_FOUND', 'Route not found.');
            const user = await services.authenticate(req.headers.authorization);
            user.requestId = requestId;
            await services.limit(user);
            // No tenant switching by query or caller-supplied university IDs.
            if ('tenantId' in query || 'universityId' in query)
                fail(422, 'SERVER_OWNED_FIELD', 'Tenant comes from the authenticated session.');
            const key = req.headers['idempotency-key'];
            if (path.startsWith('/api/v2/operations/')) {
                const output=await services.operations({user,method,path,query,body:['POST','PATCH'].includes(method)?await jsonBody(req):{},key});
                if(output.file){const f=output.file,bytes=Buffer.from(f.bytes);res.writeHead(200,{'Content-Type':f.mime,'Content-Disposition':'attachment; filename="'+f.name.replace(/[^A-Za-z0-9._-]/g,'_')+'"','Content-Length':bytes.length});res.end(bytes);}else send(output.data,output.status||200);
                return;
            }
            if (path.startsWith('/api/v2/university/')) {
                const output = await services.university({ user, method, path, query, body: ['POST','PATCH'].includes(method) ? await jsonBody(req) : {}, key });
                if (output.file) {
                    const file = output.file, bytes = Buffer.from(file.bytes);
                    res.writeHead(200, { 'Content-Type': file.mime, 'Content-Disposition': 'attachment; filename="' + file.name.replace(/[^A-Za-z0-9._-]/g, '_') + '"', 'Content-Length': bytes.length });
                    res.end(bytes);
                } else send(output.data, output.status || 200);
                return;
            }
            let match, data, status = 200;
            if (method === 'GET' && path === '/api/v2/auth/me')
                data = services.publicUser(user);
            else if (method === 'POST' && path === '/api/v2/auth/logout')
                data = await services.logout(user);
            else if (method === 'POST' && path === '/api/v2/auth/password')
                data = await services.changePassword(user, await jsonBody(req));
            else if (method === 'GET' && path === '/api/v2/meta')
                data = await services.metadata(user);
            else if (method === 'GET' && path === '/api/v2/dashboard')
                data = await services.dashboard(user, query);
            else if (method === 'GET' && path === '/api/v2/audit-events')
                data = await services.auditList(user, query);
            else if (method === 'GET' && path === '/api/v2/reports/ledger')
                data = await services.ledger(user, query);
            else if (path === '/api/v2/activities' && method === 'GET')
                data = await services.listActivities(user, query);
            else if (path === '/api/v2/activities' && method === 'POST') {
                data = await services.createActivity(user, await jsonBody(req), key);
                status = 201;
            }
            else if ((match = /^\/api\/v2\/activities\/([^/]+)$/.exec(path)) && method === 'GET')
                data = await services.getActivity(user, match[1]);
            else if ((match = /^\/api\/v2\/activities\/([^/]+)$/.exec(path)) && method === 'PATCH')
                data = await services.editActivity(user, match[1], await jsonBody(req));
            else if ((match = /^\/api\/v2\/activities\/([^/]+)\/(submit|start-review|verify|reject)$/.exec(path)) && method === 'POST') {
                data = await services.transition(user, match[1], match[2], await jsonBody(req));
                if (match[2] === 'verify')
                    status = 202;
            }
            else if ((path === '/api/v2/documents/upload' || /^\/api\/v2\/documents\/[^/]+\/retry-upload$/.test(path)) && method === 'POST') {
                await services.uploadLimit(user);
                if (uploads >= config.maxUploads)
                    fail(429, 'UPLOAD_BUSY', 'Upload capacity is busy. Retry shortly.');
                uploads++;
                uploadSlot = true;
                const bytes = await readBody(req, config.maxUploadBytes);
                let name;
                try {
                    name = decodeURIComponent(req.headers['x-filename'] || '');
                }
                catch {
                    fail(422, 'INVALID_FILENAME', 'X-Filename must be URL encoded.');
                }
                if (path.endsWith('/retry-upload'))
                    data = await services.retryUpload(user, path.split('/')[4], bytes, req.headers['content-type'], name);
                else
                    data = await services.upload(user, name, req.headers['content-type'], bytes, key);
                status = 202;
            }
            else if ((match = /^\/api\/v2\/documents\/([^/]+)\/download$/.exec(path)) && method === 'GET') {
                const file = await services.download(user, match[1]);
                res.writeHead(200, { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename="invoice"; filename*=UTF-8''${encodeURIComponent(file.name).replaceAll("'", '%27')}`, 'Content-Length': file.bytes.length });
                res.end(file.bytes);
                return;
            }
            else if ((match = /^\/api\/v2\/documents\/([^/]+)\/confirm$/.exec(path)) && method === 'POST') {
                data = await services.confirmInvoice(user, match[1], await jsonBody(req), key);
                status = 201;
            }
            else if ((match = /^\/api\/v2\/documents\/([^/]+)$/.exec(path)) && method === 'GET')
                data = await services.getDocument(user, match[1]);
            else if ((match = /^\/api\/v2\/factors\/([^/]+)\/approve$/.exec(path)) && method === 'POST')
                data = await services.approveFactor(user, match[1]);
            else if ((match = /^\/api\/v2\/periods\/([^/]+)\/(lock|unlock)$/.exec(path)) && method === 'POST')
                data = await services.setPeriod(user, match[1], await jsonBody(req), match[2] === 'lock');
            else if ((match = /^\/api\/v2\/users\/([^/]+)$/.exec(path)) && method === 'PATCH')
                data = await services.updateUser(user, match[1], await jsonBody(req));
            else if ((match = /^\/api\/v2\/jobs\/([^/]+)\/retry$/.exec(path)) && method === 'POST')
                data = await services.retryJob(user, match[1], await jsonBody(req));
            else if ((match = /^\/api\/v2\/(campuses|buildings|periods|factors|users|documents|jobs)$/.exec(path)) && method === 'GET')
                data = await services.listResource(user, match[1], query);
            else if ((match = /^\/api\/v2\/(campuses|buildings|periods|factors|users)$/.exec(path)) && method === 'POST') {
                data = await services.createResource(user, match[1], await jsonBody(req), key);
                status = 201;
            }
            else
                fail(404, 'NOT_FOUND', 'Route not found.');
            send(data, status);
        }
        catch (error) {
            if (res.headersSent) {
                res.destroy();
                return;
            }
            const r = errorResponse(error, requestId);
            if (r.status === 429 || r.status === 503)
                res.setHeader('Retry-After', '60');
            res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(r.body));
            if (!req.complete)
                req.resume();
            if (r.status >= 500)
                log({ event: 'request_error', requestId, code: error?.code || 'INTERNAL_ERROR' });
        }
    });
    server.headersTimeout = 15000;
    server.requestTimeout = 90000;
    server.keepAliveTimeout = 5000;
    return { server, metrics, drain() { draining = true; server.closeIdleConnections(); } };
}
