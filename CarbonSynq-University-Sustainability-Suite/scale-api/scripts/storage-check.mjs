import { config } from '../src/config.mjs';
import { createPool, tenantTx } from '../src/db.mjs';
import { createStorage } from '../src/storage.mjs';
import { uuid, hash } from '../src/core.mjs';
// Read-only evidence integrity check. Does not delete, overwrite or auto-repair cloud objects.
const cfg = config(), tenant = uuid(process.env.CHECK_TENANT_ID, 'CHECK_TENANT_ID');
const pool = await createPool(cfg), storage = await createStorage(cfg);
let after = null, checked = 0, failures = 0;
try {
    do {
        const rows = await tenantTx(pool, tenant, async (c) => (await c.query("SELECT id,object_key,object_version,sha256,file_size FROM cs.documents WHERE tenant_id=$1 AND object_version IS NOT NULL AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 50", [tenant, after])).rows);
        if (!rows.length)
            break;
        for (const d of rows) {
            checked++;
            try {
                const b = await storage.get(d.object_key, d.object_version, Number(d.file_size));
                if (hash(b) !== d.sha256 || b.length !== Number(d.file_size))
                    throw Error('DIGEST_MISMATCH');
            }
            catch {
                failures++;
                console.error(JSON.stringify({ event: 'integrity_failure', documentId: d.id }));
            }
        }
        after = rows.at(-1).id;
    } while (true);
    console.log(JSON.stringify({ checked, failures, readOnly: true }));
    if (failures)
        process.exitCode = 1;
}
finally {
    await pool.end();
    storage.close();
}
