import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
const target = new URL('../.env', import.meta.url);
if (existsSync(target)) {
    console.log('.env already exists; no secrets were overwritten.');
    process.exit(0);
}
const secret = () => randomBytes(24).toString('hex');
const owner = secret(), api = secret(), worker = secret(), s3 = secret();
const content = `# Local-only integration environment. Never expose this Compose stack to the Internet.
NODE_ENV=development
HOST=127.0.0.1
PORT=8080
ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
DB_OWNER_PASSWORD=${owner}
DB_API_PASSWORD=${api}
DB_WORKER_PASSWORD=${worker}
DATABASE_OWNER_URL=postgres://cs_owner:${owner}@127.0.0.1:5433/carbonsynq
DATABASE_URL=postgres://cs_api:${api}@127.0.0.1:5433/carbonsynq
WORKER_DATABASE_URL=postgres://cs_worker:${worker}@127.0.0.1:5433/carbonsynq
DB_SSL=false
DB_POOL_MAX=10
S3_BUCKET=carbonsynq-evidence
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=cs-local-only
AWS_SECRET_ACCESS_KEY=${s3}
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
METRICS_TOKEN=${secret()}
REQUEST_HASH_SECRET=${secret()}
MAX_UPLOAD_BYTES=10485760
MAX_INFLIGHT_UPLOADS=4
MAX_INFLIGHT_REQUESTS=64
WORKER_POLL_MS=1000
JOB_LEASE_SECONDS=180
SCAN_TIMEOUT_MS=45000
SESSION_HOURS=8
TRUST_PROXY=false
# Explicit local-development features: no email is sent in capture mode.
PUBLIC_BASE_URL=http://localhost:8080
MAIL_MODE=capture
MAIL_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}
MAIL_CAPTURE_DIR=.private-mail
OCR_ENABLED=true
`;
writeFileSync(target, content, { mode: 0o600, flag: 'wx' });
console.log('Created scale-api/.env with random local secrets. Local email is captured, NOT sent. English OCR is opt-in enabled in this local setup. Run docker compose up --build -d.');
