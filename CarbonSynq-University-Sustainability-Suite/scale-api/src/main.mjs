import { config } from './config.mjs';
import { createPool, assertRuntimeRole } from './db.mjs';
import { createStorage } from './storage.mjs';
import { services } from './services.mjs';
import { createApp } from './http.mjs';
const cfg = config(), pool = await createPool(cfg), storage = await createStorage(cfg);
await assertRuntimeRole(pool);
await storage.check();
const app = createApp(cfg, services(pool, storage, cfg));
app.server.listen(cfg.port, cfg.host, () => console.log(JSON.stringify({ event: 'started', port: cfg.port, mode: cfg.production ? 'production' : 'development', api: '/api/v2', syntheticSeed: false })));
app.server.on('error', async (e) => { console.error(JSON.stringify({ event: 'server_error', code: e.code })); await pool.end().catch(() => { }); storage.close(); process.exitCode = 1; });
let stopping = false;
async function stop() { if (stopping)
    return; stopping = true; app.drain(); const deadline = setTimeout(() => process.exit(1), 95000); deadline.unref(); app.server.close(async () => { await pool.end(); storage.close(); clearTimeout(deadline); process.exitCode = 0; }); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
