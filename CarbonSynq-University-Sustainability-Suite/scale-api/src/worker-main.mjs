import { operationsConfig } from './operations/crypto.mjs';
import { processMail } from './operations/mail.mjs';
import { processSweep } from './operations/reminders.mjs';
import { processExport } from './operations/exports.mjs';
import { processOcr } from './operations/ocr.mjs';
import { extractImport, XLSX_MIME } from './ingestion/parser.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.mjs';
import { id } from './core.mjs';
import { createPool, assertRuntimeRole, tenantTx } from './db.mjs';
import { createStorage } from './storage.mjs';
import { scanWithClamd, extractBounded } from './scanner.mjs';
import { claimJob, failJob, processCalculation, processInvoice, reconcileUpload, ownedJob, done } from './jobs.mjs';
const ops = operationsConfig();
const cfg = config(process.env, true), pool = await createPool(cfg), storage = await createStorage(cfg), workerId = id();
await assertRuntimeRole(pool, true);
await storage.check();
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
console.log(JSON.stringify({ event: 'worker_started', workerId }));
let maintenance = 0, heartbeatRunning = false;
const heartbeat = async () => { if (heartbeatRunning)
    return; heartbeatRunning = true; try {
    await pool.query('INSERT INTO cs.worker_heartbeats(worker_id) VALUES($1) ON CONFLICT(worker_id) DO UPDATE SET updated_at=now()', [workerId]);
}
catch {
    console.error(JSON.stringify({ event: 'heartbeat_failed', workerId }));
}
finally {
    heartbeatRunning = false;
} };
await heartbeat();
const heartbeatTimer = setInterval(heartbeat, 15000);
heartbeatTimer.unref();
try {
    while (!stopping) {
        let job;
        try {
            await heartbeat();
            if (Date.now() - maintenance > 60000) {
                maintenance = Date.now();
                await pool.query('DELETE FROM cs.rate_buckets WHERE bucket_key IN (SELECT bucket_key FROM cs.rate_buckets WHERE expires_at<now() LIMIT 1000)');
                await pool.query("DELETE FROM cs.worker_heartbeats WHERE updated_at<now()-interval '1 day'");
            }
            job = await claimJob(pool, cfg.leaseSeconds);
            if (!job) {
                await sleep(cfg.workerPollMs);
                continue;
            }
            if (job.kind === 'CALCULATE')
                await processCalculation(pool, job);
            else if (job.kind === 'SCAN_INVOICE')
                await processInvoice(pool, storage, bytes => scanWithClamd(bytes, cfg), (bytes,mime) => [XLSX_MIME,'text/csv','application/pdf'].includes(mime) ? extractImport(bytes,mime) : extractBounded(bytes,mime), job);
            else if (job.kind === 'OPS_SWEEP') await processSweep(pool,job,ops);
            else if (job.kind === 'SEND_MAIL') await processMail(pool,job,ops);
            else if (job.kind === 'BUILD_EXPORT') await processExport(pool,storage,job,ops);
            else if (job.kind === 'OCR_DOCUMENT') await processOcr(pool,storage,job,ops);
            else if (job.kind === 'RECONCILE_UPLOAD') {
                // Reconciliation is idempotent; acknowledge only with the current fencing token.
                await tenantTx(pool, job.tenant_id, c => ownedJob(c, job));
                await reconcileUpload(pool, storage, job.tenant_id, job.entity_id);
                await tenantTx(pool, job.tenant_id, async (c) => { await ownedJob(c, job); await done(c, job); });
            }
            console.log(JSON.stringify({ event: 'job_done', jobId: job.id, kind: job.kind }));
        }
        catch (error) {
            if (job) {
                const table=({SEND_MAIL:'u_o_mail',BUILD_EXPORT:'u_o_exports',OCR_DOCUMENT:'u_o_ocr_runs'})[job.kind];
                if(table)await tenantTx(pool,job.tenant_id,async c=>{await ownedJob(c,job);await c.query(`UPDATE cs.${table} SET status='FAILED',error_code=$3 WHERE tenant_id=$1 AND id=$2 AND status NOT IN ('${table==='u_o_mail'?'SENT':'COMPLETE'}'${table==='u_o_exports'?",'APPROVED','REJECTED','READY'":table==='u_o_mail'?",'CAPTURED','CANCELLED'":",'CANCELLED'"})`,[job.tenant_id,job.entity_id,/^[A-Z_]{2,50}$/.test(error?.code||'')?error.code:'PROCESSING_FAILED']);}).catch(()=>{});
            }
            if (job)
                await failJob(pool, job, error).catch(() => { });
            console.error(JSON.stringify({ event: 'job_error', jobId: job?.id, code: error?.code || 'PROCESSING_FAILED' }));
            await sleep(cfg.workerPollMs);
        }
    }
}
finally {
    clearInterval(heartbeatTimer);
    await pool.query('DELETE FROM cs.worker_heartbeats WHERE worker_id=$1', [workerId]).catch(() => { });
    await pool.end();
    storage.close();
}
