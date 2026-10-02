/** Shared helpers for the opt-in real-PostgreSQL acceptance suites.
 * These suites are never run by `npm test`; absence of infrastructure must fail loudly.
 * TLS follows the same trust rules as the application (src/config.mjs): verified
 * certificates when DB_SSL=true, optionally pinned with DB_CA_FILE. Without this a
 * suite could only ever run against a plaintext local PostgreSQL, never a provider
 * such as Neon or RDS that refuses insecure connections.
 */
import { readFileSync } from 'node:fs';

export function testSsl(env = process.env) {
    if (env.DB_SSL !== 'true') return false;
    return { rejectUnauthorized: true, ...(env.DB_CA_FILE ? { ca: readFileSync(env.DB_CA_FILE, 'utf8') } : {}) };
}
