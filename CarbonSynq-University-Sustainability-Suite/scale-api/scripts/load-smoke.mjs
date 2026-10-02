/** Conservative opt-in READ-ONLY staging smoke, not a capacity benchmark. */
if (process.env.CONFIRM_STAGING_LOAD !== 'yes')
    throw Error('Use only on your own staging environment; set CONFIRM_STAGING_LOAD=yes.');
const base = process.env.BASE_URL, token = process.env.ACCESS_TOKEN;
if (!base || !token)
    throw Error('BASE_URL and ACCESS_TOKEN are required.');
const url = new URL(base);
if (!['http:', 'https:'].includes(url.protocol))
    throw Error('HTTP(S) URL required.');
const concurrency = Number(process.env.CONCURRENCY || 4), requests = Number(process.env.REQUESTS || 100);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20 || !Number.isInteger(requests) || requests < 1 || requests > 250)
    throw Error('Use concurrency 1..20, requests 1..250; respects the default user rate budget.');
let next = 0;
const times = [], status = {};
const start = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => { while (next++ < requests) {
    const t = performance.now();
    try {
        const r = await fetch(new URL('/api/v2/activities?limit=20', url), { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
        await r.arrayBuffer();
        status[r.status] = (status[r.status] || 0) + 1;
    }
    catch {
        status.NETWORK_ERROR = (status.NETWORK_ERROR || 0) + 1;
    }
    times.push(performance.now() - t);
} }));
times.sort((a, b) => a - b);
const percentile = p => Math.round(times[Math.min(times.length - 1, Math.ceil(times.length * p) - 1)]);
console.log(JSON.stringify({ requests, concurrency, status, elapsedSeconds: (performance.now() - start) / 1000, p50ms: percentile(.5), p95ms: percentile(.95), p99ms: percentile(.99), isCapacityCertification: false }, null, 2));
if (Object.keys(status).some(s => s !== '200'))
    process.exitCode = 1;
