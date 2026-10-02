# CarbonSynq Scale Foundation - HLD and Complete New Source

> New v2 module only. All original demo/Neon source is also preserved in the complete ZIP; this is not an integrated legacy migration.

> 47 complete source/configuration/schema/API/test files follow the HLD. Infrastructure integration is unexecuted; see VERIFICATION.md.

# CarbonSynq University Product Backend: High-Level Design

**Delivery:** Scale Foundation 2.0.0-rc.1, 2 October 2026.  
**Status:** Implemented new source path; local offline tests passed; real infrastructure integration and production acceptance remain open.

## 1. Decision and boundary

The existing package is useful for CEO rehearsal but is not evidence of product-scale operation. Its root service is a localhost SQLite application and its original Neon repository is a separate implementation. This delivery adds `scale-api/` without modifying either one. New routes use `/api/v2`; the existing UI/DTOs/database have not been transparently switched.

The new scope is university/campus/building consumption capture, invoice evidence, independent review, deterministic Scope 1/location-based Scope 2 calculation and leadership reporting. This is not a full sustainability ERP, Scope 3 inventory, billing platform, independent assurance service or an automatic OCR product.

A modular API plus a separate worker was chosen rather than a large collection of microservices. State is in PostgreSQL and private object storage. There is no Redis requirement: shared rate counters and the transactional job queue also use PostgreSQL. This simplifies the initial deployment, while making the database a resource whose connection budget, query plans and load must be measured.

## 2. Implemented topology

```text
University browser / other API clients
  | HTTPS in a public deployment
  v
TLS reverse proxy / load balancer / abuse protection  [deployment responsibility]
  |
  +--> Node API replica A -----+
  +--> Node API replica B -----+--> PostgreSQL primary, cs schema
            |                       sessions / tenants / activities / factors
            |                       evidence metadata / jobs / audit / summaries
            +------------------> Private versioned S3 bucket
                                    original invoice bytes, opaque keys

Separate worker replicas
  | claim PostgreSQL jobs with lease + fencing token
  +--> S3 pinned-version read + SHA-256 verification
  +--> Private ClamD malware scan
  +--> Bounded text-parser worker thread
  +--> Human-review-ready evidence metadata
  +--> Approved calculation + summary + audit + job ACK in one transaction
```

The delivered Compose file is a **local integration stack**, not the public topology. It has one API with a localhost-bound published port, one worker by default, PostgreSQL, a local versioned S3-compatible fixture and ClamAV. Public TLS, multi-zone database HA, autoscaling, secret management and alert routing are not deployed by this ZIP.

## 3. Code and runtime boundaries

| Area | Source | Responsibility |
| --- | --- | --- |
| Entry points | `src/main.mjs`, `src/worker-main.mjs` | API / independent worker startup, role checks and shutdown |
| Transport | `src/http.mjs`, `src/services.mjs` | Fixed routing, limits, CORS, headers, service wiring, readiness |
| Identity | `src/auth.mjs` | Login, sessions, revocation, password changes, shared limits |
| Tenant persistence | `src/db.mjs` | Dedicated transactions, local tenant context, idempotency, audit, enqueue |
| Workspace | `src/management.mjs` | Campus/building/period/user/factor administration |
| Ledger | `src/activities.mjs`, `src/jobs.mjs` | Drafts, review, factor checks and calculation jobs |
| Evidence | `src/documents.mjs`, `src/storage.mjs` | Upload reservation, quota, immutable version references, downloads |
| Scan / extract | `src/scanner.mjs`, `src/extract-thread.mjs`, `src/invoice-text.mjs` | ClamD protocol and bounded extraction, never fabricated OCR |
| Reporting | `src/reporting.mjs`, `src/metrics.mjs` | Aggregate dashboard, bounded ledger/audit pages, operational metrics |
| Console | `public/` | No build step or external assets; calls real v2 endpoints |
| Schema | `migrations/001_core.sql` | New cs schema, constraints, RLS, indexes, grants, immutable triggers |

## 4. Tenancy and identity

Each business record is attached to a tenant. An opaque session token contains a tenant UUID prefix for lookup and a random 256-bit secret. The database stores only its digest; an attacker cannot authenticate by changing the tenant prefix. Business tenant identity is derived from the successfully authenticated session. Login takes a tenant ID because the user has not yet authenticated.

All tenant transactions borrow one database client, begin, set `app.tenant_id` transaction-locally, perform work, commit/rollback, and release. Queries include tenant predicates and tables additionally enforce RLS. Business table owners are not runtime users. API startup requires the dedicated `cs_api` role; the worker uses `cs_worker`; superuser, BYPASSRLS and table ownership are refused. The worker has an explicit cross-tenant queue policy for claiming ID-only jobs, but performs ledger work inside the target tenant context. It cannot read the user/session tables.

RLS is defense in depth against missing predicates, not protection against a fully compromised application that has database credentials and can set tenant context. Database owners/operators can change schema and grants. Infrastructure network policy, credential separation and application security remain necessary.

Passwords use asynchronous scrypt with random salts. Sessions expire (8 hours by default), are revoked on logout/access changes, and all sessions are revoked after password change. Browser tokens are kept in memory, not localStorage. Closing the page loses the client token but does not immediately delete the server session. No public signup, emailed invitations, password recovery, university SSO or MFA provider is implemented.

## 5. Data model and invariants

| Entity | Key invariant |
| --- | --- |
| `tenants` | Root organization; ACTIVE/SUSPENDED; reserved storage usage cannot exceed quota |
| `users`, `sessions` | Tenant-specific identity, unique email per tenant, role, active state, hashed token |
| `campuses`, `buildings` | Composite tenant/campus foreign keys prevent mislinked hierarchy |
| `periods` | Inclusive date range, OPEN/LOCKED, optimistic version |
| `factors` | Draft then independently approved; source, region, method, validity and version; immutable once approved |
| `documents` | Unique tenant file digest and normalized invoice key; original name separate from private opaque object key; pinned object version |
| `activities` | Exact quantity, canonical unit, period/hierarchy, source, expected version and explicit workflow |
| `calculations` | At most one immutable calculation per tenant/activity; quantity/factor/provenance snapshotted |
| `monthly_totals` | Grouped by tenant, period, campus, month, scope and category; only calculation commits increment totals |
| `audit_events` | Append-only under normal runtime grants/triggers; actor/action/entity/request ID and details |
| `idempotency_keys` | Actor+route+key receipt with HMAC payload digest; 24-hour replay window |
| `jobs` | Unique tenant/dedupe key; leased at-least-once execution, attempts, retry deadline and dead status |
| `rate_buckets`, `worker_heartbeats` | Shared abuse counters and operational liveness, no customer payloads |

Quantities and API numeric amounts are decimal strings. Quantities use NUMERIC(24,6), factors NUMERIC(24,9), calculations NUMERIC(38,6) and money NUMERIC(20,2). Input integer digits are further bounded. The database computes `round(quantity * factor, 6)` for kgCO2e. Tonnes equal kgCO2e divided by 1,000. The UI rounds display values only; the ledger keeps the stored precision. Source extraction suggestions may have a looser representation and must be human-confirmed into the exact-string API.

Invoice rupee values never become consumption quantities. One invoice maps to one activity in this release. Multi-line splits, one activity with several evidence documents, replacements and revisions to an already-calculated inventory need separate governed workflows.

## 6. Manual capture and review

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> VERIFIED -> CALCULATED
                           |
                           +-> REJECTED -> edit -> DRAFT
```

An ENTRY or ADMIN creates a draft. Its creator or an ADMIN can edit draft/rejected inputs and submit. REVIEWER/ADMIN can review and reject. Verification requires another person, including when the creator is an administrator. Factor creation/approval has the same independent-person rule.

Record versions reject stale edits. Date/hierarchy/category/unit and open-period checks run inside the write transaction. A manual fingerprint detects the same period/campus/building/date/category/unit/quantity; a genuinely separate matching record requires a reason. Different requests can use separate override slots; this is an audited safeguard, not fraud detection.

Verification checks the approved factor's category, unit, scope and effective dates, then updates the activity and enqueues its calculation atomically. The worker rechecks invariants and period state before calculating. The approved factor's geography and methodology are visible for human selection; the code cannot certify that a chosen factor matches a university's actual accounting policy.

An administrator cannot lock a period with unresolved activities. Lock/reopening requires a reason and version. Calculated records are immutable under the public workflow. Corrections need a designed adjustment/reversal workflow; this release does not silently rewrite historical calculations.

## 7. Idempotency and concurrency

Creation endpoints require `Idempotency-Key`. In the transaction, a PostgreSQL advisory lock serializes the same tenant/user/route/key. The payload digest uses HMAC with an environment secret, so membership requests containing passwords do not leave a simple offline dictionary hash. Matching retries return the stored receipt; changed payloads conflict. All API replicas must use the same secret. Rotating it during the replay window needs a controlled procedure.

An uncertain COMMIT is not blindly replayed internally. Clients reuse the same key/payload for create retries or GET the record after an ambiguous versioned transition. Request idempotency and domain duplicate checks are separate protections.

The API keeps no authoritative session, quota or ledger state in process memory. Local memory counters only provide per-replica overload protection. Shared rate buckets provide cross-replica per-user/tenant/login controls. These do not replace an edge WAF or network DDoS protection.

## 8. Invoice ingestion and recovery

The API accepts exactly one raw PDF/PNG/JPEG/TXT file per upload, at most 10 MB. MIME, extension, signature, nonempty content and filename are checked. `X-Filename` is URL-encoded. ZIP and multipart batches are not accepted. Original names never determine storage paths.

The sequence is deliberate:

1. Authenticate/authorize, validate bytes, compute SHA-256.
2. In PostgreSQL, reserve tenant quota, create UPLOADING metadata, store idempotency receipt, add a delayed reconciliation job and audit the reservation.
3. Write bytes to a private opaque S3 key. Require bucket versioning and retain the returned object VersionId.
4. In PostgreSQL, record the pinned version, move to QUEUED, and add the scan job.
5. The worker reads that exact version, checks size and SHA-256, scans it through private ClamD, then extracts only after a clean verdict.
6. REVIEW_REQUIRED documents can be downloaded for human review and confirmed into drafts. INFECTED becomes REJECTED; scanner failure is retried rather than accepted as clean.

A timeout does not prove that S3 did not persist the object. A five-minute delayed reconciliation checks the exact key's version, metadata digest and size. It either completes queueing or marks UPLOAD_FAILED and releases the reservation. An ADMIN may then retry the exact bytes under a fresh opaque key. The original accepted version is never overwritten by the retry flow. Object checksum verification occurs before processing or download as well.

Logical quota counts reserved application file bytes, **not total cloud storage billing**. Ambiguous SDK retries, old object versions and late orphan PUTs can consume additional storage. A governed orphan/retention process is a production gate, not an implemented deletion daemon. Automatic deletion is intentionally absent.

## 9. Scanner and parser boundary

`scanWithClamd` implements bounded INSTREAM frames and waits for an unambiguous response. Errors, disconnects, timeouts, encrypted/over-limit alerts and unknown replies do not become CLEAN. The provided ClamD configuration alerts on scan limits and encrypted content. Operators must keep signatures fresh and validate actual engine behavior in their deployment. An antivirus clean result is not a guarantee that a file is harmless.

ClamD's TCP protocol is unauthenticated; keep it private. The source uses a separate Node worker thread for supported text/PDF extraction with a time limit and V8 heap limits. Worker threads reduce parser contention but are **not an OS security sandbox** and heap limits do not bound all native allocations. Container resource limits, network isolation, hostile-file review and stronger process isolation remain release gates.

The conservative parser reuses the previous demo's supported text extraction. Image-only scans, complex fonts and unsupported layouts require manual fields. It does not call any cloud OCR provider, LLM or external document service. `ocrAvailable` remains false. No confidence score or detected field is invented to impress a viewer.

## 10. Durable jobs and aggregation

Workers use `FOR UPDATE SKIP LOCKED` to claim available jobs and a fresh lease token for every attempt. A job has a bounded attempt count, exponential backoff and DEAD state. Finalization checks that the current unexpired lease token still owns the job. A stale worker cannot acknowledge a successor's lease.

Delivery is at least once. Duplicate processing is handled by business idempotency and a unique calculation key, not by claiming universal exactly-once execution. A successful calculation transaction inserts the immutable result, increments summaries only on a new insertion, advances the activity, writes audit and acknowledges the job together.

Upload reconciliation additionally uses object-key/state compare-and-set to prevent an old retry from replacing a newer reservation. Human confirmations and irreversible calculation events have their own duplicate constraints. Administrators can requeue DEAD jobs with an audited explanation.

Worker heartbeat does not mean the backlog is empty, a scanner is healthy, signatures are current, or every tenant is processing fairly. Alert on queue age, retries, DEAD jobs and storage reservations. There is no priority/fair-share tenant scheduler in this release.

## 11. Reporting and console

The dashboard reads calculated-only monthly aggregates, not draft or pending estimates. It exposes emissions totals, calculated/evidence-linked record counts, campus contributions, review pipeline and job states. Evidence coverage is a count ratio, not the percentage of emissions independently audited.

List endpoints use bounded cursor pagination (1-100 rows). Audit pages use a bigint `before` cursor; ledger export uses a UUID `after` cursor. Ledger exports are paginated JSON, not an unbounded CSV dump. Live pages are not a snapshot; lock the reporting period before final export. Metadata returns up to 500 of each lookup type, the dashboard up to 240 month/scope rows and 100 campuses, with these limits disclosed.

The new console is self-contained HTML/CSS/JS with role-aware views for leadership, activity capture, invoices, jobs and workspace setup. Not every management API has a dedicated UI screen: building creation, period lock/access changes and password changes are also available through the API. Data displayed comes from APIs; a newly provisioned real workspace has zero inventory. The included preview images use clearly labeled UI test fixtures, not customer results.

## 12. Deployment and operations

Production settings require verified PostgreSQL TLS and HTTPS origins; a custom S3 endpoint must be HTTPS. S3 startup checks require versioning; production also checks the four public-access-block settings and configured encryption. Runtime roles must not own application tables. The local Compose API does not receive the migration-owner or worker database credentials; the worker receives its own role only. Local object-store credentials are for a test fixture, not recommended cloud IAM.

`/healthz` is process liveness. `/readyz` checks PostgreSQL, object-storage configuration and recent worker heartbeat, with brief caching. `/metrics` is protected with a separate bearer credential and exports status counters, inflight count and latency histograms. These are basic metrics, not a complete observability platform. Logs contain request IDs/status/timing, not full request bodies, passwords or tokens.

Graceful API drain stops accepting new work, closes idle connections and bounds shutdown. Worker stop finishes the current bounded job before exiting where possible; a crash is recovered via leases. DB query/lock timeouts and bounded request buffers limit resource occupation. Per-process overload protection does not establish an SLA.

Migration uses a dedicated operator credential, advisory lock and checksum history. It creates a new cs schema and runtime roles if missing; it does not alter the old application tables or rotate an existing database role's password. It is not an automatic import of existing data.

See OPERATIONS for pool budgeting, backups, recovery, scanner operations and staged rollouts. Database backups alone do not contain invoice bytes. S3 version preservation, managed point-in-time recovery and restore drills are separate responsibilities.

## 13. Scale claims and acceptance

The source removes several obvious local-demo boundaries: file bytes are outside the application database, the API can be replicated without local authoritative state, writes use transactional guards, and worker jobs can be claimed concurrently. Those are **architectural provisions**, not measured traffic capacity.

A capacity statement requires a named database/storage/scanner configuration, dataset size, traffic mix, upload sizes, tenant distribution, concurrent writers, queue-age target and measured latency/error budgets. This delivery does not certify 1,000 users, 10,000 campuses, any requests-per-second figure or multi-region availability.

The default database pool maximum is 10 per process. Plan an upper bound such as `API replicas * API pool + worker replicas * worker pool + operators + migration headroom`, then stay within the chosen database's connection budget. This formula is planning arithmetic, not a benchmark. Tune against actual query plans and production-like concurrency.

## 14. Verification and remaining work

Offline tests exercise pure validation, exact reference arithmetic, workflow rules, actual Node HTTP handling with injected services, transaction/SQL adapter behavior and an actual local socket protocol fixture. The ClamD fixture is not a real malware engine. Schema-text assertions are not execution of PostgreSQL RLS.

A real PostgreSQL integration suite and GitHub workflow are included; neither ran against real PostgreSQL in this environment. The suite uses controlled S3/scanner fixtures, so a successful future run will still not prove real object storage or antivirus integration. Live S3 versioning, malware rejection, worker restarts, multi-replica races, restore and load tests remain mandatory. The new UI was rendered in Chromium through a local fixture harness; browser navigation to localhost was blocked, so that check did not validate network/CSP deployment behavior.

SSO/MFA/invitation recovery, Scope 3, multi-document allocations, calculated-entry correction policies, tenant lifecycle/billing, official factor import, warehouse/partitioning strategy, external tamper evidence, backups/retention automation and original-service contract migration remain additional product work. Select and implement these according to actual customer obligations, rather than presenting placeholders as finished features.

## 15. Primary technical references

PostgreSQL RLS and its owner/BYPASSRLS limits: https://www.postgresql.org/docs/17/ddl-rowsecurity.html  
PostgreSQL row locks / SKIP LOCKED: https://www.postgresql.org/docs/17/sql-select.html  
node-postgres transactions and connection discipline: https://node-postgres.com/features/transactions  
node-postgres pool operations: https://node-postgres.com/features/pooling  
OWASP file upload guidance: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html  
S3 versioning: https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html  
ClamAV scanning and private TCP requirement: https://docs.clamav.net/manual/Usage/Scanning.html

References informed the design; they do not certify this code or replace project-specific testing.

**Identity nuance:** independent approval is enforced at distinct user-account-ID level. The university must govern whether those accounts belong to genuinely separate, authorized reviewers.


---
# Complete new source files


## .github/workflows/scale-ci.yml

````yaml
name: Scale API checks
on: [push, pull_request]
permissions:
  contents: read
jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-bookworm
        env:
          POSTGRES_USER: cs_owner
          POSTGRES_PASSWORD: ci-owner-only-password-not-production
          POSTGRES_DB: carbonsynq_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U cs_owner -d carbonsynq_test"
          --health-interval 5s --health-timeout 5s --health-retries 20
    defaults:
      run:
        working-directory: scale-api
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      # Generate/review/commit a lockfile, then change this to npm ci before release.
      - run: npm install --ignore-scripts --no-fund --no-audit
      - run: npm run check
      - run: npm test
      - run: npm run test:integration
        env:
          TEST_DATABASE_ADMIN_URL: postgres://cs_owner:ci-owner-only-password-not-production@127.0.0.1:5432/carbonsynq_test
      - run: npm audit --omit=dev --audit-level=high
      - run: npm test
        working-directory: .

````


## START-SCALE.cmd

````batch
@echo off
cd /d "%~dp0scale-api"
node scripts\setup-env.mjs
if errorlevel 1 goto failure
docker compose up --build -d
if errorlevel 1 goto failure
echo.
echo Scale services requested. Check: docker compose ps
echo Create your first tenant: docker compose run --rm migrate node scripts/provision.mjs
echo Then open http://localhost:8080 using the printed tenant ID and credentials.
echo This local stack is not a public production deployment.
pause
exit /b 0
:failure
echo Setup failed. Check Node, Docker Desktop, network access and the messages above.
pause
exit /b 1

````


## START-SCALE.sh

````bash
#!/bin/sh
set -eu
cd "$(dirname "$0")/scale-api"
node scripts/setup-env.mjs
docker compose up --build -d
printf '\nCheck docker compose ps. Then create your tenant:\n'
printf 'docker compose run --rm migrate node scripts/provision.mjs\n'
printf 'Open http://localhost:8080 after services are healthy. Local integration only.\n'

````


## scale-api/.dockerignore

````text
node_modules
.env
.env.*
backups
docs/*results*

````


## scale-api/.env.example

````text
# For local random secrets run: npm run setup
# This example is for MANAGED staging/production. Never commit real credentials.
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
ALLOWED_ORIGINS=https://carbon.your-university.example
DATABASE_URL=postgres://cs_api:REPLACE@DB_HOST/DB_NAME
WORKER_DATABASE_URL=postgres://cs_worker:REPLACE@DB_HOST/DB_NAME
DATABASE_OWNER_URL=postgres://MIGRATION_OWNER:REPLACE@DB_HOST/DB_NAME
DB_API_PASSWORD=REPLACE_WITH_24_PLUS_RANDOM_CHARACTERS
DB_WORKER_PASSWORD=REPLACE_WITH_24_PLUS_RANDOM_CHARACTERS
DB_SSL=true
# DB_CA_FILE=/run/secrets/database-ca.pem
DB_POOL_MAX=10
AWS_REGION=ap-south-1
S3_BUCKET=YOUR_PRIVATE_VERSIONED_BUCKET
# AWS credential provider chain / workload identity preferred. No long-lived access keys required.
# S3_ENDPOINT=https://your-s3-compatible-endpoint.example
S3_FORCE_PATH_STYLE=false
CLAMAV_HOST=clamav.private
CLAMAV_PORT=3310
METRICS_TOKEN=REPLACE_WITH_32_PLUS_RANDOM_CHARACTERS
REQUEST_HASH_SECRET=REPLACE_WITH_32_PLUS_RANDOM_CHARACTERS
MAX_UPLOAD_BYTES=10485760
MAX_INFLIGHT_UPLOADS=4
MAX_INFLIGHT_REQUESTS=64
WORKER_POLL_MS=1000
JOB_LEASE_SECONDS=180
SCAN_TIMEOUT_MS=45000
SESSION_HOURS=8
TRUST_PROXY=false

````


## scale-api/.gitignore

````text
.env
.env.*
!.env.example
node_modules/
backups/
*.log
load-results.json
ui-artifacts/
__pycache__/

````


## scale-api/Dockerfile

````text
FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
# No lockfile is fabricated: registry access was unavailable during delivery.
# Release gate: generate/review package-lock.json, then replace this with npm ci.
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node docs/openapi.json ./docs/openapi.json
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 8080
CMD ["node","src/main.mjs"]

````


## scale-api/compose.yaml

````yaml
# LOCAL INTEGRATION STACK ONLY. For public deployments use docs/OPERATIONS.md.
# No cloud resources are created by this file.
x-app: &app
  build: .
  init: true
  read_only: true
  tmpfs: [/tmp:size=64m,mode=1777]
  cap_drop: [ALL]
  security_opt: [no-new-privileges:true]
  stop_grace_period: 100s
x-runtime-env: &runtime-env
  NODE_ENV: development
  HOST: 0.0.0.0
  PORT: 8080
  DB_SSL: 'false'
  DB_POOL_MAX: '10'
  S3_BUCKET: ${S3_BUCKET}
  S3_ENDPOINT: http://object-store:9000
  S3_FORCE_PATH_STYLE: 'true'
  AWS_REGION: us-east-1
  AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
  AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
  CLAMAV_HOST: scanner
  CLAMAV_PORT: '3310'
  TRUST_PROXY: 'false'
services:
  database:
    image: postgres:17-bookworm
    environment:
      POSTGRES_USER: cs_owner
      POSTGRES_PASSWORD: ${DB_OWNER_PASSWORD}
      POSTGRES_DB: carbonsynq
    ports: ['127.0.0.1:5433:5432']
    volumes: [postgres-data:/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD-SHELL','pg_isready -U cs_owner -d carbonsynq']
      interval: 5s
      timeout: 3s
      retries: 30
  object-store:
    build:
      context: .
      dockerfile: deploy/Dockerfile.object-store
    command: server /data --console-address ':9001'
    environment:
      MINIO_ROOT_USER: ${AWS_ACCESS_KEY_ID}
      MINIO_ROOT_PASSWORD: ${AWS_SECRET_ACCESS_KEY}
    ports: ['127.0.0.1:9000:9000','127.0.0.1:9001:9001']
    volumes: [object-data:/data]
  storage-init:
    <<: *app
    depends_on: [object-store]
    environment:
      S3_BUCKET: ${S3_BUCKET}
      S3_ENDPOINT: http://object-store:9000
      S3_FORCE_PATH_STYLE: 'true'
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
    command: ['node','scripts/storage-init.mjs']
  scanner:
    image: clamav/clamav:stable
    volumes:
      - clam-db:/var/lib/clamav
      - ./deploy/clamd.conf:/etc/clamav/clamd.conf:ro
    ports: ['127.0.0.1:3310:3310']
    healthcheck:
      test: ['CMD-SHELL',"printf 'PING\n' | nc -w 3 127.0.0.1 3310 | grep -q PONG"]
      interval: 15s
      timeout: 5s
      retries: 60
    # Signature database download can delay first startup. No scan bypass is provided.
  migrate:
    <<: *app
    environment:
      NODE_ENV: development
      DB_SSL: 'false'
      DATABASE_OWNER_URL: postgres://cs_owner:${DB_OWNER_PASSWORD}@database:5432/carbonsynq
      DB_API_PASSWORD: ${DB_API_PASSWORD}
      DB_WORKER_PASSWORD: ${DB_WORKER_PASSWORD}
    command: ['node','scripts/migrate.mjs']
    depends_on:
      database: {condition: service_healthy}
  worker:
    <<: *app
    environment:
      <<: *runtime-env
      WORKER_DATABASE_URL: postgres://cs_worker:${DB_WORKER_PASSWORD}@database:5432/carbonsynq
    command: ['node','src/worker-main.mjs']
    restart: unless-stopped
    depends_on:
      migrate: {condition: service_completed_successfully}
      storage-init: {condition: service_completed_successfully}
      scanner: {condition: service_healthy}
  api:
    <<: *app
    environment:
      <<: *runtime-env
      DATABASE_URL: postgres://cs_api:${DB_API_PASSWORD}@database:5432/carbonsynq
      ALLOWED_ORIGINS: http://localhost:8080,http://127.0.0.1:8080
      METRICS_TOKEN: ${METRICS_TOKEN}
      REQUEST_HASH_SECRET: ${REQUEST_HASH_SECRET}
    ports: ['127.0.0.1:8080:8080']
    restart: unless-stopped
    depends_on:
      migrate: {condition: service_completed_successfully}
      storage-init: {condition: service_completed_successfully}
    healthcheck:
      test: ['CMD','node','-e',"fetch('http://127.0.0.1:8080/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 12s
      retries: 10
volumes:
  postgres-data:
  object-data:
  clam-db:

````


## scale-api/deploy/Dockerfile.object-store

````text
# LOCAL TEST FIXTURE ONLY. Use managed private S3 for the production plan.
# Build the upstream security-fix release; do not silently use a pre-fix Docker image.
FROM golang:1.25-bookworm AS build
ARG MINIO_REF=RELEASE.2025-10-15T17-29-55Z
RUN git clone --depth 1 --branch "$MINIO_REF" https://github.com/minio/minio.git /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/minio .
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/minio /usr/local/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]

````


## scale-api/deploy/clamd.conf

````text
Foreground yes
LogTime yes
LogClean no
TCPSocket 3310
TCPAddr 0.0.0.0
User clamav
DatabaseDirectory /var/lib/clamav
LocalSocket /tmp/clamd.sock
FixStaleSocket yes
MaxThreads 4
MaxQueue 20
StreamMaxLength 12M
MaxFileSize 12M
MaxScanSize 50M
MaxRecursion 10
MaxFiles 1000
MaxScanTime 30000
AlertExceedsMax yes
AlertEncrypted yes
ScanPDF yes
ScanArchive yes
ReadTimeout 60
CommandReadTimeout 30

````


## scale-api/deploy/nginx.conf.example

````text
# Fragment for a TLS-terminating reverse proxy; certificate paths must be supplied by your operator.
# The API must NOT also be publicly reachable. Do not trust client-provided proxy headers.
upstream carbon_api {
    least_conn;
    server api-1:8080;
    server api-2:8080;
    keepalive 32;
}
server {
    listen 443 ssl;
    server_name carbon.your-university.example;
    ssl_certificate /run/secrets/tls.crt;
    ssl_certificate_key /run/secrets/tls.key;
    client_max_body_size 10m;
    client_body_timeout 30s;
    location /metrics { deny all; }
    location / {
        proxy_pass http://carbon_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 90s;
        proxy_connect_timeout 5s;
    }
}

````


## scale-api/docs/openapi.json

````json
{
  "openapi": "3.1.0",
  "info": {
    "title": "CarbonSynq Scale Foundation API",
    "version": "2.0.0-rc.1",
    "description": "New v2 implementation, not wire-compatible with the original v1/Neon service. Staging validation required. Exact decimal values return as strings; database-backed rows use snake_case while request DTOs use camelCase. Errors contain request IDs, never database stack traces. This reference has typed request schemas; Success.data remains endpoint-specific (see source and API-WORKFLOW.md). It is not a fully typed client-generation contract."
  },
  "servers": [
    {
      "url": "http://localhost:8080",
      "description": "Local integration stack only"
    }
  ],
  "paths": {
    "/healthz": {
      "get": {
        "operationId": "get__healthz",
        "summary": "Process liveness",
        "description": "Process liveness",
        "tags": [
          "operations"
        ],
        "security": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/readyz": {
      "get": {
        "operationId": "get__readyz",
        "summary": "Dependency readiness: PostgreSQL, protected versioned object storage and recent worker heartbeat",
        "description": "HTTP 200 when ready, 503 otherwise. Check results cached briefly. A heartbeat is not proof of fresh malware signatures.",
        "tags": [
          "operations"
        ],
        "security": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/metrics": {
      "get": {
        "operationId": "get__metrics",
        "summary": "Prometheus metrics (separate METRICS_TOKEN bearer credential)",
        "description": "Not a user-session credential. Keep scraping private.",
        "tags": [
          "operations"
        ],
        "security": [
          {
            "metricsBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "text/plain": {
                "schema": {
                  "type": "string"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v2/auth/login": {
      "post": {
        "operationId": "post__api_v2_auth_login",
        "summary": "Sign in with tenant ID, email and password",
        "description": "Sign in with tenant ID, email and password",
        "tags": [
          "auth"
        ],
        "security": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Login"
              }
            }
          }
        }
      }
    },
    "/api/v2/auth/me": {
      "get": {
        "operationId": "get__api_v2_auth_me",
        "summary": "Current authenticated identity",
        "description": "Current authenticated identity",
        "tags": [
          "auth"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v2/auth/logout": {
      "post": {
        "operationId": "post__api_v2_auth_logout",
        "summary": "Revoke the current session",
        "description": "Revoke the current session",
        "tags": [
          "auth"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v2/auth/password": {
      "post": {
        "operationId": "post__api_v2_auth_password",
        "summary": "Change password and revoke every session for this user",
        "description": "Change password and revoke every session for this user",
        "tags": [
          "auth"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PasswordChange"
              }
            }
          }
        }
      }
    },
    "/api/v2/meta": {
      "get": {
        "operationId": "get__api_v2_meta",
        "summary": "Tenant metadata and canonical categories; each lookup list capped at 500",
        "description": "Tenant metadata and canonical categories; each lookup list capped at 500",
        "tags": [
          "meta"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        }
      }
    },
    "/api/v2/dashboard": {
      "get": {
        "operationId": "get__api_v2_dashboard",
        "summary": "Calculated-only totals and bounded aggregate breakdowns",
        "description": "Calculated-only totals and bounded aggregate breakdowns",
        "tags": [
          "dashboard"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "periodId",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/audit-events": {
      "get": {
        "operationId": "get__api_v2_audit_events",
        "summary": "Append-only audit event pages",
        "description": "Use nextBefore as the next before cursor. IDs travel as strings.",
        "tags": [
          "audit-events"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "before",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            }
          }
        ]
      }
    },
    "/api/v2/reports/ledger": {
      "get": {
        "operationId": "get__api_v2_reports_ledger",
        "summary": "Paginated JSON inventory ledger and factor provenance",
        "description": "Uses nextAfter, not the generic nextCursor. Live pagination is not a point-in-time snapshot. Lock the period for final reporting.",
        "tags": [
          "reports"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "after",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "periodId",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            }
          }
        ]
      }
    },
    "/api/v2/activities": {
      "get": {
        "operationId": "get__api_v2_activities",
        "summary": "List tenant activities",
        "description": "List tenant activities",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          },
          {
            "name": "periodId",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "campusId",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ]
      },
      "post": {
        "operationId": "post__api_v2_activities",
        "summary": "Create manual consumption draft: ADMIN or ENTRY",
        "description": "Create manual consumption draft: ADMIN or ENTRY",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ActivityCreate"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          }
        ]
      }
    },
    "/api/v2/activities/{id}": {
      "get": {
        "operationId": "get__api_v2_activities_id",
        "summary": "Read activity and immutable calculation snapshot",
        "description": "Read activity and immutable calculation snapshot",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      },
      "patch": {
        "operationId": "patch__api_v2_activities_id",
        "summary": "Edit own draft/rejected entry; ADMIN may edit tenant drafts",
        "description": "Edit own draft/rejected entry; ADMIN may edit tenant drafts",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/ActivityEdit"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/activities/{id}/submit": {
      "post": {
        "operationId": "post__api_v2_activities_id_submit",
        "summary": "Submit a draft",
        "description": "Submit a draft",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Version"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/activities/{id}/start-review": {
      "post": {
        "operationId": "post__api_v2_activities_id_start_review",
        "summary": "Start review: REVIEWER or ADMIN",
        "description": "Start review: REVIEWER or ADMIN",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Version"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/activities/{id}/verify": {
      "post": {
        "operationId": "post__api_v2_activities_id_verify",
        "summary": "Verify with approved factor; enqueues calculation atomically; creator cannot verify",
        "description": "Verify with approved factor; enqueues calculation atomically; creator cannot verify",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "202": {
            "description": "Accepted for asynchronous processing",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Verify"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/activities/{id}/reject": {
      "post": {
        "operationId": "post__api_v2_activities_id_reject",
        "summary": "Reject with reason: REVIEWER or ADMIN",
        "description": "Reject with reason: REVIEWER or ADMIN",
        "tags": [
          "activities"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Reject"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/documents/upload": {
      "post": {
        "operationId": "post__api_v2_documents_upload",
        "summary": "Reserve quota and upload invoice into quarantine: ADMIN or ENTRY",
        "description": "Returns document operation. Reuse the original key and bytes after uncertain network outcomes. Poll GET document until REVIEW_REQUIRED, REJECTED or UPLOAD_FAILED. No AI OCR is connected.",
        "tags": [
          "documents"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "202": {
            "description": "Accepted for asynchronous processing",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "description": "Raw bytes, NOT multipart/form-data or base64. Maximum 10 MB; Content-Type must match file signature and extension.",
          "content": {
            "application/pdf": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            },
            "image/png": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            },
            "image/jpeg": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            },
            "text/plain": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          },
          {
            "name": "X-Filename",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "URL-encoded original basename, including extension."
          }
        ]
      }
    },
    "/api/v2/documents/{id}": {
      "get": {
        "operationId": "get__api_v2_documents_id",
        "summary": "Read invoice processing state and field suggestions",
        "description": "Read invoice processing state and field suggestions",
        "tags": [
          "documents"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/documents/{id}/download": {
      "get": {
        "operationId": "get__api_v2_documents_id_download",
        "summary": "Download pinned original evidence after a clean scan",
        "description": "Download pinned original evidence after a clean scan",
        "tags": [
          "documents"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/octet-stream": {
                "schema": {
                  "type": "string",
                  "format": "binary"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/documents/{id}/confirm": {
      "post": {
        "operationId": "post__api_v2_documents_id_confirm",
        "summary": "Confirm actual consumption and create invoice-linked draft",
        "description": "Confirm actual consumption and create invoice-linked draft",
        "tags": [
          "documents"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/InvoiceConfirm"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          }
        ]
      }
    },
    "/api/v2/documents/{id}/retry-upload": {
      "post": {
        "operationId": "post__api_v2_documents_id_retry_upload",
        "summary": "ADMIN retries exact bytes after UPLOAD_FAILED; state guards prevent overwrite",
        "description": "Not generic upload replay. Use only after reconciliation marks UPLOAD_FAILED. Each retry reserves a fresh opaque object key. On transport failure, poll the same document; do not blindly resend.",
        "tags": [
          "documents"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "202": {
            "description": "Accepted for asynchronous processing",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "description": "Raw bytes, NOT multipart/form-data or base64. Maximum 10 MB; Content-Type must match file signature and extension.",
          "content": {
            "application/pdf": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            },
            "image/png": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            },
            "image/jpeg": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            },
            "text/plain": {
              "schema": {
                "type": "string",
                "format": "binary"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          },
          {
            "name": "X-Filename",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string"
            },
            "description": "URL-encoded original basename, including extension."
          }
        ]
      }
    },
    "/api/v2/campuses": {
      "get": {
        "operationId": "get__api_v2_campuses",
        "summary": "List campuses",
        "description": "List campuses",
        "tags": [
          "campuses"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          }
        ]
      },
      "post": {
        "operationId": "post__api_v2_campuses",
        "summary": "Create campuses record: ADMIN only",
        "description": "Create campuses record: ADMIN only",
        "tags": [
          "campuses"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/campusesCreate"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          }
        ]
      }
    },
    "/api/v2/buildings": {
      "get": {
        "operationId": "get__api_v2_buildings",
        "summary": "List buildings",
        "description": "List buildings",
        "tags": [
          "buildings"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          }
        ]
      },
      "post": {
        "operationId": "post__api_v2_buildings",
        "summary": "Create buildings record: ADMIN only",
        "description": "Create buildings record: ADMIN only",
        "tags": [
          "buildings"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/buildingsCreate"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          }
        ]
      }
    },
    "/api/v2/periods": {
      "get": {
        "operationId": "get__api_v2_periods",
        "summary": "List periods",
        "description": "List periods",
        "tags": [
          "periods"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          }
        ]
      },
      "post": {
        "operationId": "post__api_v2_periods",
        "summary": "Create periods record: ADMIN only",
        "description": "Create periods record: ADMIN only",
        "tags": [
          "periods"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/periodsCreate"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          }
        ]
      }
    },
    "/api/v2/factors": {
      "get": {
        "operationId": "get__api_v2_factors",
        "summary": "List factors",
        "description": "List factors",
        "tags": [
          "factors"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          }
        ]
      },
      "post": {
        "operationId": "post__api_v2_factors",
        "summary": "Create factors record: ADMIN only",
        "description": "Create factors record: ADMIN only",
        "tags": [
          "factors"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/factorsCreate"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          }
        ]
      }
    },
    "/api/v2/users": {
      "get": {
        "operationId": "get__api_v2_users",
        "summary": "List users (ADMIN only)",
        "description": "List users (ADMIN only)",
        "tags": [
          "users"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          }
        ]
      },
      "post": {
        "operationId": "post__api_v2_users",
        "summary": "Create users record: ADMIN only",
        "description": "Create users record: ADMIN only",
        "tags": [
          "users"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "201": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/usersCreate"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "Idempotency-Key",
            "in": "header",
            "required": true,
            "schema": {
              "type": "string",
              "pattern": "^[A-Za-z0-9._:-]{8,128}$"
            },
            "description": "Same key and payload replay original operation for 24 hours. A changed payload conflicts."
          }
        ]
      }
    },
    "/api/v2/documents": {
      "get": {
        "operationId": "get__api_v2_documents",
        "summary": "List documents",
        "description": "List documents",
        "tags": [
          "documents"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          }
        ]
      }
    },
    "/api/v2/jobs": {
      "get": {
        "operationId": "get__api_v2_jobs",
        "summary": "List jobs",
        "description": "List jobs",
        "tags": [
          "jobs"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100,
              "default": 50
            }
          },
          {
            "name": "cursor",
            "in": "query",
            "schema": {
              "type": "string"
            },
            "description": "Use nextCursor returned by the preceding page, not an offset."
          }
        ]
      }
    },
    "/api/v2/factors/{id}/approve": {
      "post": {
        "operationId": "post__api_v2_factors_id_approve",
        "summary": "Independently approve a factor version: REVIEWER or ADMIN",
        "description": "Independently approve a factor version: REVIEWER or ADMIN",
        "tags": [
          "factors"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/periods/{id}/lock": {
      "post": {
        "operationId": "post__api_v2_periods_id_lock",
        "summary": "Lock reporting period with reason and expected version: ADMIN",
        "description": "Lock reporting period with reason and expected version: ADMIN",
        "tags": [
          "periods"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PeriodState"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/periods/{id}/unlock": {
      "post": {
        "operationId": "post__api_v2_periods_id_unlock",
        "summary": "Unlock reporting period with reason and expected version: ADMIN",
        "description": "Unlock reporting period with reason and expected version: ADMIN",
        "tags": [
          "periods"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PeriodState"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/users/{id}": {
      "patch": {
        "operationId": "patch__api_v2_users_id",
        "summary": "Set user access and revoke sessions; last active admin protected",
        "description": "Set user access and revoke sessions; last active admin protected",
        "tags": [
          "users"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UserAccess"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    },
    "/api/v2/jobs/{id}/retry": {
      "post": {
        "operationId": "post__api_v2_jobs_id_retry",
        "summary": "Requeue DEAD job with an audit reason: ADMIN",
        "description": "Requeue DEAD job with an audit reason: ADMIN",
        "tags": [
          "jobs"
        ],
        "security": [
          {
            "sessionBearer": []
          }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Success"
                }
              }
            }
          },
          "400": {
            "description": "Malformed request",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "401": {
            "description": "Missing, expired or invalid authentication",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "description": "Role, origin or database access denied",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "404": {
            "description": "Record absent in authenticated tenant",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "409": {
            "description": "Conflict: stale version, workflow, duplicate or quota",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "413": {
            "description": "Upload or body too large",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "415": {
            "description": "Unsupported type / signature mismatch",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "422": {
            "description": "Validation failed",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "429": {
            "description": "Rate or concurrency limit",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "500": {
            "description": "Unexpected internal failure",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "503": {
            "description": "Dependency unavailable, draining, timeout, or ambiguous upload outcome",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          }
        },
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/RetryReason"
              }
            }
          }
        },
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "format": "uuid"
            }
          }
        ]
      }
    }
  },
  "components": {
    "securitySchemes": {
      "sessionBearer": {
        "type": "http",
        "scheme": "bearer",
        "description": "Opaque tenant-prefixed token returned by login; not JWT."
      },
      "metricsBearer": {
        "type": "http",
        "scheme": "bearer",
        "description": "Separate operator METRICS_TOKEN."
      }
    },
    "schemas": {
      "Login": {
        "type": "object",
        "properties": {
          "tenantId": {
            "type": "string",
            "format": "uuid"
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "password": {
            "type": "string",
            "maxLength": 128
          }
        },
        "required": [
          "tenantId",
          "email",
          "password"
        ]
      },
      "PasswordChange": {
        "type": "object",
        "properties": {
          "currentPassword": {
            "type": "string"
          },
          "newPassword": {
            "type": "string",
            "minLength": 12,
            "maxLength": 128
          }
        },
        "required": [
          "currentPassword",
          "newPassword"
        ]
      },
      "ActivityCreate": {
        "type": "object",
        "properties": {
          "periodId": {
            "type": "string",
            "format": "uuid"
          },
          "campusId": {
            "type": "string",
            "format": "uuid"
          },
          "buildingId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "category": {
            "type": "string",
            "enum": [
              "PURCHASED_ELECTRICITY",
              "DIESEL",
              "PETROL",
              "LPG",
              "NATURAL_GAS"
            ]
          },
          "unit": {
            "type": "string",
            "enum": [
              "kWh",
              "litre",
              "kg",
              "m3"
            ]
          },
          "quantity": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$",
            "description": "Positive decimal STRING. At most 12 integer digits and 6 fractional places."
          },
          "activityDate": {
            "type": "string",
            "format": "date"
          },
          "description": {
            "type": "string",
            "maxLength": 2000
          },
          "duplicateReason": {
            "type": "string",
            "minLength": 10,
            "maxLength": 500
          }
        },
        "required": [
          "periodId",
          "campusId",
          "category",
          "unit",
          "quantity",
          "activityDate"
        ]
      },
      "ActivityEdit": {
        "type": "object",
        "properties": {
          "periodId": {
            "type": "string",
            "format": "uuid"
          },
          "campusId": {
            "type": "string",
            "format": "uuid"
          },
          "buildingId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "category": {
            "type": "string",
            "enum": [
              "PURCHASED_ELECTRICITY",
              "DIESEL",
              "PETROL",
              "LPG",
              "NATURAL_GAS"
            ]
          },
          "unit": {
            "type": "string",
            "enum": [
              "kWh",
              "litre",
              "kg",
              "m3"
            ]
          },
          "quantity": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$",
            "description": "Positive decimal STRING. At most 12 integer digits and 6 fractional places."
          },
          "activityDate": {
            "type": "string",
            "format": "date"
          },
          "description": {
            "type": "string",
            "maxLength": 2000
          },
          "duplicateReason": {
            "type": "string",
            "minLength": 10,
            "maxLength": 500
          },
          "version": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "periodId",
          "campusId",
          "category",
          "unit",
          "quantity",
          "activityDate",
          "version"
        ]
      },
      "InvoiceConfirm": {
        "type": "object",
        "properties": {
          "periodId": {
            "type": "string",
            "format": "uuid"
          },
          "campusId": {
            "type": "string",
            "format": "uuid"
          },
          "buildingId": {
            "type": [
              "string",
              "null"
            ],
            "format": "uuid"
          },
          "category": {
            "type": "string",
            "enum": [
              "PURCHASED_ELECTRICITY",
              "DIESEL",
              "PETROL",
              "LPG",
              "NATURAL_GAS"
            ]
          },
          "unit": {
            "type": "string",
            "enum": [
              "kWh",
              "litre",
              "kg",
              "m3"
            ]
          },
          "quantity": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$",
            "description": "Positive decimal STRING. At most 12 integer digits and 6 fractional places."
          },
          "activityDate": {
            "type": "string",
            "format": "date"
          },
          "description": {
            "type": "string",
            "maxLength": 2000
          },
          "duplicateReason": {
            "type": "string",
            "minLength": 10,
            "maxLength": 500
          },
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "vendor": {
            "type": "string",
            "maxLength": 150
          },
          "invoiceNumber": {
            "type": "string",
            "maxLength": 80
          },
          "amountInr": {
            "type": [
              "string",
              "null"
            ],
            "description": "Optional nonnegative decimal string, maximum 2 fractional digits. Informational, never quantity."
          },
          "reviewConfirmed": {
            "const": true
          }
        },
        "required": [
          "periodId",
          "campusId",
          "category",
          "unit",
          "quantity",
          "activityDate",
          "version",
          "vendor",
          "invoiceNumber",
          "reviewConfirmed"
        ]
      },
      "Version": {
        "type": "object",
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "version"
        ]
      },
      "Verify": {
        "type": "object",
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "factorId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "version",
          "factorId"
        ]
      },
      "Reject": {
        "type": "object",
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "reason": {
            "type": "string",
            "minLength": 5,
            "maxLength": 1000
          }
        },
        "required": [
          "version",
          "reason"
        ]
      },
      "PeriodState": {
        "type": "object",
        "properties": {
          "version": {
            "type": "integer",
            "minimum": 1
          },
          "reason": {
            "type": "string",
            "minLength": 10,
            "maxLength": 500
          }
        },
        "required": [
          "version",
          "reason"
        ]
      },
      "RetryReason": {
        "type": "object",
        "properties": {
          "reason": {
            "type": "string",
            "minLength": 10,
            "maxLength": 500
          }
        },
        "required": [
          "reason"
        ]
      },
      "UserAccess": {
        "type": "object",
        "properties": {
          "role": {
            "type": "string",
            "enum": [
              "ADMIN",
              "ENTRY",
              "REVIEWER",
              "LEADERSHIP"
            ]
          },
          "active": {
            "type": "boolean"
          }
        },
        "required": [
          "role",
          "active"
        ]
      },
      "campusesCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 160
          },
          "code": {
            "type": "string",
            "maxLength": 30
          }
        },
        "required": [
          "name",
          "code"
        ]
      },
      "buildingsCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 160
          },
          "campusId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "name",
          "campusId"
        ]
      },
      "periodsCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 160
          },
          "startDate": {
            "type": "string",
            "format": "date"
          },
          "endDate": {
            "type": "string",
            "format": "date"
          }
        },
        "required": [
          "name",
          "startDate",
          "endDate"
        ]
      },
      "usersCreate": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "maxLength": 160
          },
          "email": {
            "type": "string",
            "format": "email"
          },
          "role": {
            "type": "string",
            "enum": [
              "ADMIN",
              "ENTRY",
              "REVIEWER",
              "LEADERSHIP"
            ]
          },
          "password": {
            "type": "string",
            "minLength": 12,
            "maxLength": 128
          }
        },
        "required": [
          "name",
          "email",
          "role",
          "password"
        ]
      },
      "factorsCreate": {
        "type": "object",
        "properties": {
          "category": {
            "type": "string",
            "enum": [
              "PURCHASED_ELECTRICITY",
              "DIESEL",
              "PETROL",
              "LPG",
              "NATURAL_GAS"
            ]
          },
          "unit": {
            "type": "string"
          },
          "value": {
            "type": "string",
            "pattern": "^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,9})?$"
          },
          "versionLabel": {
            "type": "string",
            "maxLength": 80
          },
          "source": {
            "type": "string",
            "maxLength": 500
          },
          "sourceUrl": {
            "type": "string",
            "format": "uri",
            "pattern": "^https://"
          },
          "region": {
            "type": "string",
            "maxLength": 100
          },
          "methodology": {
            "type": "string",
            "maxLength": 1000
          },
          "validFrom": {
            "type": "string",
            "format": "date"
          },
          "validTo": {
            "type": "string",
            "format": "date"
          }
        },
        "required": [
          "category",
          "unit",
          "value",
          "versionLabel",
          "source",
          "sourceUrl",
          "region",
          "methodology",
          "validFrom",
          "validTo"
        ]
      },
      "Success": {
        "type": "object",
        "properties": {
          "success": {
            "const": true
          },
          "data": {},
          "requestId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "success",
          "data",
          "requestId"
        ]
      },
      "Error": {
        "type": "object",
        "properties": {
          "success": {
            "const": false
          },
          "error": {
            "type": "object",
            "properties": {
              "code": {
                "type": "string"
              },
              "message": {
                "type": "string"
              },
              "details": {}
            },
            "required": [
              "code",
              "message"
            ]
          },
          "requestId": {
            "type": "string",
            "format": "uuid"
          }
        },
        "required": [
          "success",
          "error",
          "requestId"
        ]
      }
    }
  }
}

````


## scale-api/migrations/001_core.sql

````sql
CREATE SCHEMA IF NOT EXISTS cs;
REVOKE ALL ON SCHEMA cs FROM PUBLIC;
CREATE TABLE cs.schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cs.tenants (
 id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
 storage_quota_bytes bigint NOT NULL DEFAULT 1073741824 CHECK(storage_quota_bytes>0), storage_used_bytes bigint NOT NULL DEFAULT 0 CHECK(storage_used_bytes>=0),
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()), CHECK(storage_used_bytes<=storage_quota_bytes)
);
CREATE TABLE cs.users (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),email text NOT NULL,name text NOT NULL,
 role text NOT NULL CHECK(role IN ('ADMIN','ENTRY','REVIEWER','LEADERSHIP')),password_hash text NOT NULL,active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,email),CHECK(email=lower(email))
);
CREATE TABLE cs.sessions (
 tenant_id uuid NOT NULL,token_hash text PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,user_id) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX sessions_expiry ON cs.sessions(expires_at);
CREATE TABLE cs.campuses (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),name text NOT NULL,code text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,code)
);
CREATE TABLE cs.buildings (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,campus_id uuid NOT NULL,name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,campus_id,id),
 FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id)
);
CREATE TABLE cs.periods (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),name text NOT NULL,start_date date NOT NULL,end_date date NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','LOCKED')),version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),CHECK(start_date<=end_date)
);
CREATE TABLE cs.factors (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),category text NOT NULL,unit text NOT NULL,scope text NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')),
 value numeric(24,9) NOT NULL CHECK(value>0),version_label text NOT NULL,source text NOT NULL,source_url text NOT NULL,region text NOT NULL,methodology text NOT NULL,
 valid_from date NOT NULL,valid_to date NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED')),created_by uuid NOT NULL,approved_by uuid,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,id),UNIQUE(tenant_id,category,region,version_label),CHECK(valid_from<=valid_to),
 CHECK((status='DRAFT' AND approved_by IS NULL) OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_by<>created_by)),
 FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,approved_by) REFERENCES cs.users(tenant_id,id)
);
CREATE TABLE cs.documents (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),original_name text NOT NULL,mime_type text NOT NULL,file_size bigint NOT NULL CHECK(file_size>0 AND file_size<=10485760),
 sha256 text NOT NULL CHECK(length(sha256)=64),object_key text NOT NULL UNIQUE,object_version text,
 status text NOT NULL DEFAULT 'UPLOADING' CHECK(status IN ('UPLOADING','QUEUED','REVIEW_REQUIRED','REJECTED','LINKED','UPLOAD_FAILED')),
 scan_result text,scan_engine text,extraction jsonb,reviewed jsonb,invoice_key text,uploaded_by uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 upload_deadline timestamptz NOT NULL DEFAULT now()+interval '5 minutes',quota_reserved boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,sha256),UNIQUE(tenant_id,invoice_key),FOREIGN KEY(tenant_id,uploaded_by) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX documents_tenant_page ON cs.documents(tenant_id,created_at DESC,id DESC);
CREATE TABLE cs.activities (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),period_id uuid NOT NULL,campus_id uuid NOT NULL,building_id uuid,
 category text NOT NULL,scope text NOT NULL CHECK(scope IN ('SCOPE_1','SCOPE_2')),unit text NOT NULL,quantity numeric(24,6) NOT NULL CHECK(quantity>0),activity_date date NOT NULL,description text NOT NULL DEFAULT '',
 input_source text NOT NULL CHECK(input_source IN ('MANUAL','INVOICE')),document_id uuid,amount_inr numeric(20,2) CHECK(amount_inr>=0),vendor text,invoice_number text,
 fingerprint text NOT NULL,duplicate_slot text NOT NULL DEFAULT '',duplicate_reason text,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','VERIFIED','CALCULATED','REJECTED')),
 factor_id uuid,created_by uuid NOT NULL,verified_by uuid,rejection_reason text,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,document_id),UNIQUE(tenant_id,fingerprint,duplicate_slot),CHECK(verified_by IS NULL OR verified_by<>created_by),
 FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id),
 FOREIGN KEY(tenant_id,campus_id,building_id) REFERENCES cs.buildings(tenant_id,campus_id,id),FOREIGN KEY(tenant_id,document_id) REFERENCES cs.documents(tenant_id,id),
 FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.factors(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES cs.users(tenant_id,id),FOREIGN KEY(tenant_id,verified_by) REFERENCES cs.users(tenant_id,id),
 CHECK((input_source='MANUAL' AND document_id IS NULL) OR (input_source='INVOICE' AND document_id IS NOT NULL))
);
CREATE INDEX activities_tenant_page ON cs.activities(tenant_id,created_at DESC,id DESC);
CREATE INDEX activities_tenant_period ON cs.activities(tenant_id,period_id,status,activity_date);
CREATE TABLE cs.calculations (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,activity_id uuid NOT NULL,factor_id uuid NOT NULL,
 quantity numeric(24,6) NOT NULL,factor_value numeric(24,9) NOT NULL,kg_co2e numeric(38,6) NOT NULL CHECK(kg_co2e>=0),factor_version text NOT NULL,factor_source text NOT NULL,
 provenance jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),UNIQUE(tenant_id,activity_id),
 FOREIGN KEY(tenant_id,activity_id) REFERENCES cs.activities(tenant_id,id),FOREIGN KEY(tenant_id,factor_id) REFERENCES cs.factors(tenant_id,id)
);
CREATE TABLE cs.monthly_totals (
 tenant_id uuid NOT NULL,period_id uuid NOT NULL,campus_id uuid NOT NULL,month date NOT NULL,scope text NOT NULL,category text NOT NULL,
 kg_co2e numeric(38,6) NOT NULL,record_count bigint NOT NULL,evidence_count bigint NOT NULL,
 PRIMARY KEY(tenant_id,period_id,campus_id,month,scope,category),FOREIGN KEY(tenant_id,period_id) REFERENCES cs.periods(tenant_id,id),FOREIGN KEY(tenant_id,campus_id) REFERENCES cs.campuses(tenant_id,id)
);
CREATE TABLE cs.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES cs.tenants(id),actor_id uuid,action text NOT NULL,entity_id uuid,details jsonb NOT NULL DEFAULT '{}',request_id text,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,actor_id) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX audit_tenant_page ON cs.audit_events(tenant_id,id DESC);
CREATE TABLE cs.idempotency_keys (
 tenant_id uuid NOT NULL,actor_id uuid NOT NULL,route text NOT NULL,request_key text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,actor_id,route,request_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES cs.users(tenant_id,id)
);
CREATE INDEX idempotency_expiry ON cs.idempotency_keys(expires_at);
CREATE TABLE cs.jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES cs.tenants(id),kind text NOT NULL CHECK(kind IN ('SCAN_INVOICE','CALCULATE','RECONCILE_UPLOAD')),
 entity_id uuid NOT NULL,dedupe_key text NOT NULL,status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','DONE','DEAD')),
 attempts integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 5,available_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,dedupe_key)
);
CREATE INDEX jobs_claim ON cs.jobs(available_at,created_at) WHERE status IN ('QUEUED','RUNNING');
CREATE TABLE cs.rate_buckets(bucket_key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE cs.worker_heartbeats(worker_id uuid PRIMARY KEY,updated_at timestamptz NOT NULL DEFAULT now());
-- Application tables: explicit tenant predicates AND enforced PostgreSQL RLS.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tenants','users','sessions','campuses','buildings','periods','factors','documents','activities','calculations','monthly_totals','audit_events','idempotency_keys','jobs'] LOOP
  EXECUTE format('ALTER TABLE cs.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE cs.%I FORCE ROW LEVEL SECURITY',t);
  IF t='tenants' THEN
   EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  ELSE
   EXECUTE format('CREATE POLICY tenant_isolation ON cs.%I USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  END IF;
 END LOOP;
END $$;
-- Only the worker may claim jobs across tenants; operational payload holds IDs, not invoice text.
CREATE POLICY worker_queue ON cs.jobs TO cs_worker USING (true) WITH CHECK (true);
CREATE FUNCTION cs.deny_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable ledger: update/delete prohibited' USING ERRCODE='42501'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON cs.audit_events FOR EACH ROW EXECUTE FUNCTION cs.deny_change();
CREATE TRIGGER calculation_immutable BEFORE UPDATE OR DELETE ON cs.calculations FOR EACH ROW EXECUTE FUNCTION cs.deny_change();
CREATE FUNCTION cs.factor_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='APPROVED' THEN RAISE EXCEPTION 'Approved factors are immutable; create a new version' USING ERRCODE='42501'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER factor_immutable BEFORE UPDATE OR DELETE ON cs.factors FOR EACH ROW EXECUTE FUNCTION cs.factor_immutable();
GRANT USAGE ON SCHEMA cs TO cs_api,cs_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA cs TO cs_api,cs_worker;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA cs TO cs_api,cs_worker;
REVOKE ALL ON cs.schema_migrations FROM cs_api,cs_worker;
REVOKE UPDATE,DELETE ON cs.audit_events,cs.calculations FROM cs_api,cs_worker;
REVOKE INSERT,UPDATE,DELETE ON cs.calculations,cs.monthly_totals FROM cs_api;
REVOKE ALL ON cs.users,cs.sessions FROM cs_worker;

REVOKE ALL ON cs.worker_heartbeats FROM cs_api;
GRANT SELECT ON cs.worker_heartbeats TO cs_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cs FROM PUBLIC;

````


## scale-api/package.json

````json
{
  "name": "carbonsynq-scale-api",
  "version": "2.0.0-rc.1",
  "private": true,
  "type": "module",
  "description": "PostgreSQL + private versioned S3 + durable worker foundation. Staging validation required.",
  "engines": {
    "node": ">=22.16.0"
  },
  "scripts": {
    "start": "node --env-file-if-exists=.env src/main.mjs",
    "worker": "node --env-file-if-exists=.env src/worker-main.mjs",
    "setup": "node scripts/setup-env.mjs",
    "migrate": "node --env-file-if-exists=.env scripts/migrate.mjs",
    "tenant:create": "node --env-file-if-exists=.env scripts/provision.mjs",
    "test": "node --test tests/unit.test.mjs tests/http.test.mjs tests/adapters.test.mjs",
    "test:integration": "node --env-file-if-exists=.env tests/postgres.integration.mjs",
    "check": "node scripts/check.mjs",
    "storage:check": "node --env-file-if-exists=.env scripts/storage-check.mjs",
    "backup": "node --env-file-if-exists=.env scripts/backup.mjs",
    "load:smoke": "node --env-file-if-exists=.env scripts/load-smoke.mjs"
  },
  "dependencies": {
    "pg": "8.23.0",
    "@aws-sdk/client-s3": "3.1143.0"
  }
}

````


## scale-api/public/app.js

````javascript
'use strict';
const $ = s => document.querySelector(s), esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = null, user = null, meta = null, view = 'overview', records = [], documents = [], jobs = [], entryContext = null, formKey = null, uploadKey = null, epoch = 0, nextCursor = null, navigation = 0;
const writable = () => ['ADMIN', 'ENTRY'].includes(user?.role), reviewer = () => ['ADMIN', 'REVIEWER'].includes(user?.role);
function notify(message, bad = false) { $('#notice').hidden = false; $('#notice').classList.toggle('bad', bad); $('#notice').textContent = message; }
async function api(path, { method = 'GET', body, raw, headers = {}, key } = {}) {
    const generation = epoch;
    const opts = { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } };
    if (body !== undefined) {
        opts.body = JSON.stringify(body);
        opts.headers['Content-Type'] = 'application/json';
    }
    if (raw !== undefined)
        opts.body = raw;
    if (key)
        opts.headers['Idempotency-Key'] = key;
    const r = await fetch('/api/v2' + path, opts);
    const result = await r.json();
    if (generation !== epoch)
        throw Error('Session changed.');
    if (!r.ok)
        throw Error(`${result.error?.message || 'Request failed'}${result.requestId ? ' [request ' + result.requestId.slice(0, 8) + ']' : ''}`);
    return result.data;
}
const number = x => Number(x || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }), pretty = x => String(x || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const badge = x => `<span class="badge ${esc(x)}">${esc(pretty(x))}</span>`;
const table = (head, rows) => `<div class="card table-wrap"><table><thead><tr>${head.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}"><div class="empty">Nothing here yet.<br>Your workspace starts with real data, not invented totals.</div></td></tr>`}</tbody></table></div>`;
function names() { return Object.fromEntries((meta?.campuses || []).map(x => [x.id, x.name])); }
function more() { return nextCursor ? '<div class="section-gap"><button class="outline dark" data-action="more">Load more records</button></div>' : ''; }
$('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    $('#loginError').textContent = '';
    try {
        const data = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        token = data.token;
        user = data.user;
        epoch++;
        meta = await api('/meta');
        $('#loginView').hidden = true;
        $('#workspace').hidden = false;
        $('#tenantName').textContent = meta.tenant.name;
        $('#userName').textContent = user.name;
        $('#userRole').textContent = pretty(user.role);
        await loadView('overview');
        e.target.password.value = '';
    }
    catch (err) {
        token = null;
        user = null;
        meta = null;
        $('#workspace').hidden = true;
        $('#loginView').hidden = false;
        $('#loginError').textContent = err.message;
    }
    finally {
        button.disabled = false;
    }
});
$('#logout').addEventListener('click', async () => { try {
    await api('/auth/logout', { method: 'POST' });
}
catch { } token = null; user = null; meta = null; records = []; documents = []; jobs = []; epoch++; $('#workspace').hidden = true; $('#view').replaceChildren(); $('#loginView').hidden = false; $('#entryDialog').close(); });
$('nav').addEventListener('click', e => { if (e.target.dataset.view)
    loadView(e.target.dataset.view).catch(err => notify(err.message, true)); });
$('#refresh').addEventListener('click', () => loadView(view).catch(err => notify(err.message, true)));
async function loadView(selected, append = false) {
    const navigationId = ++navigation;
    view = selected;
    document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === view));
    const titles = { overview: ['LEADERSHIP OVERVIEW', 'University carbon operations', 'A clear view of your reviewed inventory and the work behind it.'], entries: ['ACTIVITY LEDGER', 'Every activity. Accounted for.', 'Capture consumption, track review and preserve the calculation trail.'], invoices: ['EVIDENCE WORKSPACE', 'Invoices with accountability', 'Original files are scanned, reviewed and linked to actual consumption.'], jobs: ['PROCESSING OPERATIONS', 'Work moving in the background', 'Durable jobs with visible retries and a recoverable failure queue.'], setup: ['WORKSPACE ADMINISTRATION', 'Build your university workspace', 'Configure your people, campus structure and approved accounting factors.'] };
    const t = titles[view];
    $('#pageEyebrow').textContent = t[0];
    $('#pageTitle').textContent = t[1];
    $('#pageDescription').textContent = t[2];
    if (!append)
        nextCursor = null;
    if (view === 'overview') {
        const d = await api('/dashboard');
        if (navigationId !== navigation)
            return;
        const pending = d.pipeline.filter(x => !['CALCULATED', 'REJECTED'].includes(x.status)).reduce((a, x) => a + Number(x.count), 0), total = Number(d.totals.calculated_records), coverage = total ? 100 * Number(d.totals.invoice_backed_records) / total : 0, max = Math.max(...d.campuses.map(x => Number(x.kg_co2e)), 1);
        $('#view').innerHTML = `<div class="kpi-grid"><div class="card kpi"><div class="kpi-label">REVIEWED EMISSIONS</div><div class="kpi-number">${number(d.totals.tonnes_co2e)}<small>tCO2e</small></div><div class="kpi-note">Calculated ledger only</div></div><div class="card kpi"><div class="kpi-label">CALCULATED ACTIVITIES</div><div class="kpi-number">${number(total)}</div><div class="kpi-note">Independently verified inputs</div></div><div class="card kpi"><div class="kpi-label">AWAITING COMPLETION</div><div class="kpi-number">${number(pending)}</div><div class="kpi-note">Not included in emissions totals</div></div><div class="card kpi"><div class="kpi-label">INVOICE-BACKED RECORDS</div><div class="kpi-number">${number(coverage)}<small>%</small></div><div class="kpi-note">${number(d.totals.invoice_backed_records)} of ${number(total)} calculated records</div></div></div><div class="dashboard-grid"><section class="card"><div class="card-head"><h3>Campus contribution</h3><span class="sub-label">TONNES CO2e</span></div><div class="card-body">${d.campuses.length ? d.campuses.map(c => `<div class="bar-row"><div class="bar-title"><span>${esc(c.name)}</span><strong>${number(Number(c.kg_co2e) / 1000)}</strong></div><meter min="0" max="${max}" value="${Number(c.kg_co2e)}" aria-label="${esc(c.name)} contribution"></meter></div>`).join('') : '<div class="empty">No calculated inventory yet.<br>Complete your first independently reviewed activity.</div>'}<div class="data-note">Campus totals use the same calculation ledger as your reports. Invoice amounts never substitute for energy or fuel quantities.</div></div></section><section class="card"><div class="card-head"><h3>Review pipeline</h3><span class="sub-label">ACTIVITIES</span></div><div class="card-body">${['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'CALCULATED'].map(s => `<div class="pipeline-item">${badge(s)}<strong>${number(d.pipeline.find(x => x.status === s)?.count || 0)}</strong></div>`).join('')}<div class="data-note">Maker-checker separation: the person entering an activity cannot approve their own record.</div></div></section></div><section class="card section-gap"><div class="card-head"><h3>Operating principles</h3><span class="sub-label">NO SILENT ASSUMPTIONS</span></div><div class="card-body"><p class="muted">Approved factor versions. Preserved invoice evidence. Clear review states. No synthetic emissions are seeded into this workspace.</p>${writable() ? '<button class="primary" data-action="new">Create first / next activity &rarr;</button>' : ''}</div></section>`;
    }
    else if (['entries', 'invoices', 'jobs'].includes(view)) {
        const resource = { entries: 'activities', invoices: 'documents', jobs: 'jobs' }[view], result = await api('/' + resource + '?limit=50' + (append && nextCursor ? '&cursor=' + encodeURIComponent(nextCursor) : ''));
        if (navigationId !== navigation)
            return;
        if (view === 'entries') {
            records = append ? [...records, ...result.items] : result.items;
            nextCursor = result.nextCursor;
            renderEntries();
        }
        if (view === 'invoices') {
            documents = append ? [...documents, ...result.items] : result.items;
            nextCursor = result.nextCursor;
            renderDocuments();
        }
        if (view === 'jobs') {
            jobs = append ? [...jobs, ...result.items] : result.items;
            nextCursor = result.nextCursor;
            $('#view').innerHTML = table(['Job', 'Status', 'Attempts', 'Details', 'Action'], jobs.map(j => `<tr><td><strong>${esc(pretty(j.kind))}</strong><small>${esc(j.id.slice(0, 8))}</small></td><td>${badge(j.status)}</td><td>${j.attempts} / ${j.max_attempts}</td><td>${esc(j.last_error || 'No reported error')}</td><td>${j.status === 'DEAD' && user.role === 'ADMIN' ? `<button class="small-button" data-action="retry-job" data-id="${esc(j.id)}">Retry</button>` : ''}</td></tr>`)) + more();
        }
    }
    else {
        meta = await api('/meta');
        if (navigationId !== navigation)
            return;
        renderSetup();
    }
}
function renderEntries() { const lookup = names(); $('#view').innerHTML = `<div class="action-strip">${writable() ? '<button class="primary" data-action="new">+ New manual entry</button>' : ''}<span class="sub-label">${records.length} loaded records. API uses cursor pagination.</span></div>` + table(['Activity', 'Campus', 'Consumption', 'Status', 'Actions'], records.map(a => `<tr><td><strong>${esc(pretty(a.category))}</strong><small>${esc(a.activity_date)} &middot; ${esc(a.input_source)}</small></td><td>${esc(lookup[a.campus_id] || 'Campus')}</td><td>${esc(a.quantity)} ${esc(a.unit)}</td><td>${badge(a.status)}</td><td>${writable() && ['DRAFT', 'REJECTED'].includes(a.status) ? `<button class="small-button" data-action="edit" data-id="${a.id}">Edit</button>` : ''}${writable() && a.status === 'DRAFT' ? `<button class="small-button" data-action="submit" data-id="${a.id}">Submit</button>` : ''}${reviewer() && a.status === 'SUBMITTED' ? `<button class="small-button" data-action="start-review" data-id="${a.id}">Start review</button>` : ''}${reviewer() && a.status === 'UNDER_REVIEW' ? `<button class="small-button" data-action="verify" data-id="${a.id}">Verify</button><button class="small-button" data-action="reject" data-id="${a.id}">Reject</button>` : ''}</td></tr>`)) + more(); }
function renderDocuments() { $('#view').innerHTML = (writable() ? '<div class="upload-box"><h3>Upload an invoice</h3><p>PDF, PNG, JPEG or text. Maximum 10 MB. Scans and unsupported layouts require manual fields after the security scan.</p><input id="invoiceFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt"><button class="primary" data-action="upload">Upload evidence</button></div>' : '') + table(['Evidence', 'Size', 'Status', 'Scan result', 'Actions'], documents.map(d => `<tr><td><strong>${esc(d.original_name)}</strong><small>${esc(d.sha256.slice(0, 16))}&hellip;</small></td><td>${number(Number(d.file_size) / 1024)} KB</td><td>${badge(d.status)}</td><td>${esc(d.scan_result || 'Pending')}</td><td>${['REVIEW_REQUIRED', 'LINKED'].includes(d.status) ? `<button class="small-button" data-action="download" data-id="${d.id}">Original file</button>` : ''}${writable() && d.status === 'REVIEW_REQUIRED' ? `<button class="small-button" data-action="review-invoice" data-id="${d.id}">Review fields</button>` : ''}</td></tr>`)) + more(); }
function fillSelect(select, items, empty) { select.innerHTML = (empty ? `<option value="">${esc(empty)}</option>` : '') + items.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(''); }
function buildingOptions(selected) { const form = $('#entryForm'); fillSelect(form.buildingId, meta.buildings.filter(b => b.campus_id === form.campusId.value), 'No building / campus level'); if (selected)
    form.buildingId.value = selected; }
function unitHint() { $('#unitHint').textContent = 'Canonical unit: ' + (meta.categories[$('#entryForm').category.value]?.[1] || ''); }
async function openEntry(context = null) {
    meta = await api('/meta');
    entryContext = context;
    formKey = crypto.randomUUID();
    const f = $('#entryForm');
    f.reset();
    $('#entryError').textContent = '';
    fillSelect(f.periodId, meta.periods.filter(p => p.status === 'OPEN'));
    fillSelect(f.campusId, meta.campuses);
    fillSelect(f.category, Object.keys(meta.categories).map(k => ({ id: k, name: pretty(k) })));
    buildingOptions();
    f.activityDate.value = new Date().toISOString().slice(0, 10);
    $('#invoiceFields').hidden = !context?.invoice;
    $('#entryTitle').textContent = context?.invoice ? 'Review invoice fields' : context?.activity ? 'Edit activity' : 'New manual activity';
    if (context?.activity) {
        const a = context.activity;
        for (const [input, key] of [['periodId', 'period_id'], ['campusId', 'campus_id'], ['category', 'category'], ['quantity', 'quantity'], ['activityDate', 'activity_date'], ['description', 'description'], ['duplicateReason', 'duplicate_reason']])
            f[input].value = a[key] || '';
        buildingOptions(a.building_id);
    }
    if (context?.invoice) {
        $('#invoiceReviewNotes').textContent = (context.invoice.extraction?.warnings || ['Review actual consumption against the original file.']).join(' ');
        const fields = context.invoice.extraction?.fields || {};
        for (const name of ['vendor', 'invoiceNumber', 'amountInr', 'quantity', 'activityDate', 'category'])
            if (fields[name] !== undefined)
                f[name].value = String(fields[name]);
    }
    unitHint();
    $('#entryDialog').showModal();
}
$('#entryForm').campusId.addEventListener('change', () => buildingOptions());
$('#entryForm').category.addEventListener('change', unitHint);
$('#closeDialog').addEventListener('click', () => $('#entryDialog').close());
$('#entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    $('#entryError').textContent = '';
    try {
        const f = e.target, b = Object.fromEntries(new FormData(f));
        b.unit = meta.categories[b.category][1];
        if (!b.buildingId)
            delete b.buildingId;
        if (!b.duplicateReason)
            delete b.duplicateReason;
        if (entryContext?.invoice) {
            b.version = entryContext.invoice.version;
            b.reviewConfirmed = f.reviewConfirmed.checked;
            await api('/documents/' + entryContext.invoice.id + '/confirm', { method: 'POST', body: b, key: formKey });
        }
        else {
            delete b.vendor;
            delete b.invoiceNumber;
            delete b.amountInr;
            delete b.reviewConfirmed;
            if (entryContext?.activity) {
                b.version = entryContext.activity.version;
                await api('/activities/' + entryContext.activity.id, { method: 'PATCH', body: b });
            }
            else
                await api('/activities', { method: 'POST', body: b, key: formKey });
        }
        $('#entryDialog').close();
        notify('Draft saved. Submit it and ask a different person to review.');
        await loadView('entries');
    }
    catch (err) {
        $('#entryError').textContent = err.message;
    }
    finally {
        button.disabled = false;
    }
});
$('#view').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b)
        return;
    const action = b.dataset.action, rid = b.dataset.id;
    b.disabled = true;
    try {
        if (action === 'new')
            await openEntry();
        else if (action === 'edit')
            await openEntry({ activity: records.find(a => a.id === rid) });
        else if (action === 'review-invoice')
            await openEntry({ invoice: await api('/documents/' + rid) });
        else if (action === 'more')
            await loadView(view, true);
        else if (action === 'upload') {
            const file = $('#invoiceFile').files[0];
            if (!file)
                throw Error('Choose an invoice first.');
            uploadKey ||= crypto.randomUUID();
            await api('/documents/upload', { method: 'POST', raw: file, headers: { 'Content-Type': file.type || 'text/plain', 'X-Filename': encodeURIComponent(file.name) }, key: uploadKey });
            uploadKey = null;
            notify('Evidence received. The processing queue will show its scan status.');
            await loadView('invoices');
        }
        else if (action === 'download') {
            const r = await fetch('/api/v2/documents/' + rid + '/download', { headers: { Authorization: 'Bearer ' + token } });
            if (!r.ok)
                throw Error((await r.json()).error.message);
            const blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
            a.href = url;
            a.download = documents.find(d => d.id === rid)?.original_name || 'invoice';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        else if (['submit', 'start-review', 'verify', 'reject'].includes(action)) {
            const a = records.find(x => x.id === rid), body = { version: a.version };
            if (action === 'verify') {
                meta = await api('/meta');
                const factors = meta.factors.filter(f => f.status === 'APPROVED' && f.category === a.category && f.unit === a.unit && a.activity_date >= f.valid_from && a.activity_date <= f.valid_to);
                if (!factors.length)
                    throw Error('No matching approved factor. Create and independently approve a factor in Workspace setup.');
                const choice = prompt('Select the factor number after checking source, region and methodology:\n' + factors.map((f, i) => `${i + 1}. ${f.version_label} | ${f.region} | ${f.value} | ${f.source}`).join('\n'));
                if (choice === null)
                    return;
                const factor = factors[Number(choice) - 1];
                if (!factor)
                    throw Error('Select a valid factor number.');
                body.factorId = factor.id;
            }
            if (action === 'reject') {
                body.reason = prompt('Reason for rejection:');
                if (body.reason === null)
                    return;
            }
            await api('/activities/' + rid + '/' + action, { method: 'POST', body });
            notify(action === 'verify' ? 'Verified. A durable calculation job was queued.' : 'Workflow updated.');
            await loadView('entries');
        }
        else if (action === 'approve-factor') {
            await api('/factors/' + rid + '/approve', { method: 'POST' });
            notify('Factor approved. Its value and provenance are now immutable.');
            await loadView('setup');
        }
        else if (action === 'retry-job') {
            const reason = prompt('Why should this failed job be retried?');
            if (reason === null)
                return;
            await api('/jobs/' + rid + '/retry', { method: 'POST', body: { reason } });
            notify('Job requeued.');
            await loadView('jobs');
        }
    }
    catch (err) {
        notify(err.message, true);
    }
    finally {
        b.disabled = false;
    }
});
$('#view').addEventListener('change', e => { if (e.target.id === 'invoiceFile')
    uploadKey = null; });
function renderSetup() {
    const input = (name, label, type = 'text', full = false) => `<label class="${full ? 'full' : ''}">${label}<input name="${name}" type="${type}" required></label>`;
    $('#view').innerHTML = (user.role === 'ADMIN' ? `<div class="setup-grid"><section class="card"><form data-resource="users"><h3>Add a team member</h3><div class="field-stack">${input('name', 'Full name')}${input('email', 'Work email', 'email')}${input('password', 'Initial password (12+ characters)', 'password')}<label>Role<select name="role"><option>ENTRY</option><option>REVIEWER</option><option>LEADERSHIP</option><option>ADMIN</option></select></label></div><button class="primary section-gap">Create user</button></form></section><section class="card"><form data-resource="campuses"><h3>Add a campus</h3><div class="field-stack">${input('name', 'Campus name')}${input('code', 'Campus code')}</div><button class="primary section-gap">Create campus</button></form><form data-resource="periods"><h3>Add a reporting period</h3><div class="field-stack">${input('name', 'Period name', 'text', true)}${input('startDate', 'Start date', 'date')}${input('endDate', 'End date', 'date')}</div><button class="primary section-gap">Create period</button></form></section><section class="card full"><form data-resource="factors"><h3>Register a factor for independent approval</h3><div class="field-stack"><label>Category<select name="category">${Object.keys(meta.categories).map(k => `<option value="${esc(k)}">${esc(pretty(k))}</option>`).join('')}</select></label>${input('value', 'Factor: kgCO2e / canonical unit')}${input('versionLabel', 'Version label')}${input('region', 'Applicable geography')}${input('source', 'Published source')}${input('sourceUrl', 'HTTPS source URL', 'url')}${input('validFrom', 'Valid from', 'date')}${input('validTo', 'Valid to', 'date')}${input('methodology', 'Methodology and boundary', 'text', true)}</div><p class="fine">No official factor values are assumed. A different authorized reviewer must approve this version.</p><button class="primary">Register draft factor</button></form></section></div>` : '<div class="data-note">Only an administrator can create users, campuses and factor versions. Reviewers can independently approve factor drafts below.</div>') + '<h3 class="section-gap">Factor register</h3>' + table(['Category', 'Value / unit', 'Version / source', 'Status', 'Approval'], meta.factors.map(f => `<tr><td>${esc(pretty(f.category))}</td><td>${esc(f.value)} / ${esc(f.unit)}</td><td><strong>${esc(f.version_label)}</strong><small>${esc(f.region)} &middot; ${esc(f.source)}</small></td><td>${badge(f.status)}</td><td>${reviewer() && f.status === 'DRAFT' ? `<button class="small-button" data-action="approve-factor" data-id="${f.id}">Approve</button>` : ''}</td></tr>`));
}
$('#view').addEventListener('submit', async (e) => { const f = e.target.closest('form[data-resource]'); if (!f)
    return; e.preventDefault(); e.submitter.disabled = true; try {
    const body = Object.fromEntries(new FormData(f));
    if (f.dataset.resource === 'factors')
        body.unit = meta.categories[body.category][1];
    f.dataset.key ||= crypto.randomUUID();
    await api('/' + f.dataset.resource, { method: 'POST', body, key: f.dataset.key });
    notify('Workspace record created.');
    await loadView('setup');
}
catch (err) {
    notify(err.message, true);
    e.submitter.disabled = false;
} });

````


## scale-api/public/index.html

````html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CarbonSynq | University Operations</title><link rel="stylesheet" href="/style.css"><script defer src="/app.js"></script></head>
<body>
<section id="loginView" class="login-view">
  <div class="login-story"><div class="brand"><span class="brand-icon">C</span>CarbonSynq<span class="brand-tag">EARTH</span></div><p class="eyebrow">UNIVERSITY CARBON OPERATIONS</p><h1>From everyday data.<br>To accountable action.</h1><p>One connected workflow for campus consumption, invoice evidence and independently reviewed emissions.</p><div class="trust-row"><span>Tenant-isolated</span><span>Evidence-linked</span><span>Review-first</span></div><div class="story-foot">Consumption records &rarr; human review &rarr; traceable inventory</div></div>
  <div class="login-panel"><div class="login-card"><p class="eyebrow">YOUR WORKSPACE</p><h2>Welcome back</h2><p class="muted">Use the tenant ID and credentials created by your administrator.</p><form id="loginForm"><label>University tenant ID<input name="tenantId" required autocomplete="off" placeholder="University UUID"></label><label>Work email<input name="email" required type="email" autocomplete="username" placeholder="you@university.edu"></label><label>Password<input name="password" required type="password" autocomplete="current-password"></label><button class="primary" type="submit">Sign in to workspace <span>&rarr;</span></button></form><p class="fine">No public demo credentials. The sign-in token stays in browser memory. Closing this page requires signing in again.</p><div id="loginError" class="error" role="alert"></div></div></div>
</section>
<div id="workspace" class="workspace" hidden>
<aside class="sidebar"><div class="brand"><span class="brand-icon">C</span>CarbonSynq</div><div class="workspace-label">UNIVERSITY WORKSPACE</div><div id="tenantName" class="tenant-name"></div><nav aria-label="Main navigation"><button data-view="overview" class="nav active">Overview</button><button data-view="entries" class="nav">Activity ledger</button><button data-view="invoices" class="nav">Invoice evidence</button><button data-view="jobs" class="nav">Processing queue</button><button data-view="setup" class="nav">Workspace setup</button></nav><div class="sidebar-bottom"><div class="security-mark">Independent review.<br>Traceable calculations.</div><a href="/openapi.json" target="_blank" rel="noopener">API contract &nearr;</a><button id="logout" class="outline">Sign out</button></div></aside>
<main><header class="topbar"><div><span class="workspace-label">CARBON INVENTORY</span><span class="chip">Scope 1 + 2</span></div><div class="account"><span id="userName"></span><span id="userRole" class="role"></span></div></header><section class="content"><div class="page-heading"><div><p class="eyebrow" id="pageEyebrow">LEADERSHIP OVERVIEW</p><h1 id="pageTitle">University carbon operations</h1><p id="pageDescription" class="muted">A clear view of your reviewed inventory and the work behind it.</p></div><button id="refresh" class="outline dark">Refresh data &orarr;</button></div><div id="notice" class="notice" role="status" hidden></div><div id="view"></div><footer>Only calculated activities contribute to emissions. Evidence coverage is record-based, not an assurance opinion.</footer></section></main>
</div>
<dialog id="entryDialog"><div class="dialog-heading"><div><p class="eyebrow" id="entryEyebrow">CONSUMPTION CAPTURE</p><h2 id="entryTitle">New activity</h2></div><button id="closeDialog" class="icon-button" aria-label="Close">&times;</button></div><form id="entryForm"><div class="form-grid"><label>Reporting period<select name="periodId" required></select></label><label>Campus<select name="campusId" required></select></label><label>Building<select name="buildingId"></select></label><label>Category<select name="category" required></select></label><label>Consumption quantity<input name="quantity" required inputmode="decimal" placeholder="12500.000000"><small id="unitHint">Actual consumption, never invoice money</small></label><label>Activity date<input name="activityDate" required type="date"></label><label class="full">Description<input name="description" maxlength="2000" placeholder="Meter, asset or consumption context"></label><label class="full">Separate duplicate record? Explain why (optional)<input name="duplicateReason" maxlength="500"></label></div><div id="invoiceFields" hidden><p id="invoiceReviewNotes" class="data-note"></p><div class="form-grid"><label>Supplier<input name="vendor"></label><label>Invoice number<input name="invoiceNumber"></label><label>Amount in INR (optional)<input name="amountInr" inputmode="decimal"></label><div class="evidence-note">Bill value is retained as evidence. It is not used as a consumption quantity.</div></div><label class="check"><input type="checkbox" name="reviewConfirmed">I checked the original invoice and confirmed the actual consumption.</label></div><div class="dialog-actions"><button class="primary" type="submit">Save draft</button></div><div id="entryError" class="error" role="alert"></div></form></dialog>
</body></html>

````


## scale-api/public/style.css

````css
:root{font-family:Inter,"Segoe UI",Arial,sans-serif;color:#163535;background:#f3f6f5;font-synthesis:none;--ink:#123a39;--muted:#647d7a;--brand:#0b8277;--line:#deE7e3;--paper:#fff}*{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}button,a{touch-action:manipulation}button{cursor:pointer;border:0}button:disabled{cursor:wait;opacity:.55}input,select,textarea{width:100%;border:1px solid #cedbd6;border-radius:8px;background:#fff;padding:11px 12px;color:var(--ink);margin-top:7px;min-width:0}input:focus,select:focus,button:focus-visible,a:focus-visible{outline:3px solid #9addcf;outline-offset:2px}label{font-size:13px;font-weight:600;display:block}h1,h2,h3,p{margin-top:0}h1{letter-spacing:-1.3px;line-height:1.14}h2{letter-spacing:-.6px}p{line-height:1.6}.muted,.fine{color:var(--muted)}.fine{font-size:12px;line-height:1.65;margin-top:22px}.eyebrow{font-size:11px;font-weight:750;letter-spacing:2px;color:var(--brand);margin-bottom:14px}.brand{display:flex;align-items:center;gap:10px;font-size:23px;font-weight:700;letter-spacing:-.7px}.brand-icon{background:#b6ead8;color:#164a42;width:34px;height:34px;display:grid;place-items:center;border-radius:10px;font-size:24px}.brand-tag{font-size:9px;letter-spacing:2px;font-weight:500;align-self:end;padding-bottom:4px}.login-view{min-height:100vh;display:grid;grid-template-columns:1.12fr 1fr}.login-story{background:#103e3c;color:#f5faf6;padding:54px 70px;display:flex;flex-direction:column;justify-content:center;position:relative;overflow:hidden}.login-story .brand{position:absolute;top:46px;left:70px}.login-story h1{font-size:clamp(36px,4vw,60px);margin:18px 0 24px}.login-story>.eyebrow{color:#91cdbd}.login-story>p:not(.eyebrow){max-width:475px;font-size:17px;color:#c1d8d0}.trust-row{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0;color:#cee9dc;font-size:12px}.trust-row span{border-top:2px solid #75bb9c;padding-top:12px}.story-foot{position:absolute;bottom:46px;font-size:11px;letter-spacing:.3px;color:#9cbbb2}.login-panel{display:grid;place-items:center;padding:45px;background:#f7f9f7}.login-card{width:100%;max-width:390px}.login-card h2{font-size:34px;margin-bottom:10px}.login-card label{margin-top:20px}.primary{background:var(--brand);color:#fff;padding:12px 18px;border-radius:8px;font-weight:650;display:inline-flex;justify-content:space-between;align-items:center;gap:24px}.login-card .primary{width:100%;margin-top:26px}.error{color:#a13532;font-size:13px;margin-top:16px;line-height:1.5}.workspace{display:grid;grid-template-columns:232px 1fr;min-height:100vh}.sidebar{background:#103d3c;color:#d4e5de;display:flex;flex-direction:column;padding:32px 23px;position:sticky;top:0;height:100vh}.sidebar .brand{color:white;font-size:21px;margin-bottom:44px}.workspace-label{font-size:9px;letter-spacing:1.8px;font-weight:700;display:block;color:#82a49c}.tenant-name{color:white;font-size:14px;font-weight:600;margin:10px 0 30px;line-height:1.5}.nav{width:100%;padding:13px 14px;text-align:left;background:transparent;color:#c2d7d0;border-radius:8px;margin:4px 0;font-size:13px}.nav.active{background:#275551;color:#fff;font-weight:650;border-left:3px solid #b1e9cd}.sidebar-bottom{margin-top:auto;display:grid;gap:23px}.sidebar-bottom a{color:#c3dfd2;font-size:12px;text-decoration:none}.security-mark{font-size:12px;line-height:1.65;color:#94b8aa;border-top:1px solid #315d55;padding-top:24px}.outline{background:transparent;border:1px solid #507268;color:#dcebe4;border-radius:7px;padding:9px 13px;font-size:12px;font-weight:550}.outline.dark{color:#2b5951;border-color:#c8d8d0;background:#fff}.topbar{min-height:76px;padding:20px 40px;background:white;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}.topbar>div:first-child{display:flex;align-items:center;gap:16px}.topbar .workspace-label{color:#789189}.chip,.badge,.role{display:inline-block;border-radius:20px;font-size:10px;padding:5px 9px;font-weight:650;letter-spacing:.4px;white-space:nowrap}.chip{background:#eef5ef;color:#527260}.account{display:flex;align-items:center;gap:12px;font-size:12px}.role{background:#f0f3f4;color:#566978}.content{padding:34px 40px;max-width:1480px;margin:auto}.page-heading{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-bottom:24px}.page-heading h1{font-size:32px;margin-bottom:10px}.page-heading p:last-child{font-size:13px;margin-bottom:0}.page-heading .eyebrow{margin-bottom:10px}.notice{background:#e5f2eb;border:1px solid #bcdccb;color:#24614d;padding:12px 16px;font-size:13px;border-radius:9px;margin-bottom:20px;line-height:1.5}.notice.bad{color:#983c35;background:#fff0eb;border-color:#eccabd}.kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}.card{border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden}.kpi{padding:22px}.kpi:first-child{background:#103f3b;color:white;border-color:#103f3b}.kpi-label{font-size:11px;letter-spacing:.3px;color:#6f877d}.kpi:first-child .kpi-label,.kpi:first-child .kpi-note{color:#b2d2c4}.kpi-number{font-size:36px;letter-spacing:-1.4px;font-weight:650;margin:15px 0 9px;overflow-wrap:anywhere}.kpi-number small{font-size:12px;font-weight:500;letter-spacing:0;margin-left:6px}.kpi-note{font-size:10px;color:#7b9287}.dashboard-grid{display:grid;grid-template-columns:1.25fr 1fr;gap:20px;margin-top:22px}.card-head{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:21px 24px;border-bottom:1px solid #e8eee9}.card-head h3{font-size:14px;margin:0}.sub-label{font-size:10px;color:#80968c}.card-body{padding:24px}.bar-row{margin-bottom:20px}.bar-title{display:flex;justify-content:space-between;font-size:12px;gap:18px;margin-bottom:8px}.bar-title strong{font-size:11px;white-space:nowrap}meter{width:100%;height:13px;display:block;border:0;background:#edf3ef;border-radius:20px}meter::-webkit-meter-bar{background:#edf3ef;border:0;border-radius:20px}meter::-webkit-meter-optimum-value{background:#328d7a;border-radius:20px}meter::-moz-meter-bar{background:#328d7a}.pipeline-item{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #edf1ee;padding:13px 0;font-size:12px}.pipeline-item:last-child{border-bottom:0}.pipeline-item strong{font-size:18px}.data-note{background:#f5f8f4;font-size:11px;padding:13px 15px;border-radius:8px;line-height:1.6;color:#688172;margin-top:18px}.action-strip{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:20px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12px}th{text-align:left;background:#f8faf8;color:#799085;font-size:10px;font-weight:650;letter-spacing:.7px;padding:15px 18px;border-bottom:1px solid var(--line);white-space:nowrap}td{padding:17px 18px;border-bottom:1px solid #eaf0ec;vertical-align:middle;line-height:1.45}tbody tr:last-child td{border-bottom:0}td strong{display:block;font-size:12px}td small{font-size:10px;color:#80938a}.badge{background:#eef2f0;color:#6c8176}.badge.CALCULATED,.badge.LINKED,.badge.DONE,.badge.APPROVED{background:#def0e5;color:#287657}.badge.VERIFIED,.badge.RUNNING,.badge.QUEUED{background:#e5eef8;color:#4f70a0}.badge.SUBMITTED,.badge.UNDER_REVIEW,.badge.REVIEW_REQUIRED{background:#fbf0d9;color:#96731f}.badge.REJECTED,.badge.DEAD,.badge.UPLOAD_FAILED{background:#f9e5e1;color:#a35443}.small-button{font-size:11px;color:#167c68;background:#eaf5ef;border-radius:5px;padding:7px 9px;margin:2px}.empty{padding:42px 28px;text-align:center;color:#7c9387;font-size:13px;line-height:1.7}.upload-box{border:1px dashed #9fbdb0;border-radius:10px;background:#f5faf6;padding:23px;margin-bottom:20px}.upload-box input{max-width:450px;margin:12px 12px 0 0}.upload-box p{font-size:12px;color:#74897e;margin-bottom:0}.upload-box h3{font-size:15px;margin-bottom:7px}.evidence-note{font-size:11px;line-height:1.65;color:#6b8173;align-self:center}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.full{grid-column:1/-1}.form-grid small{display:block;font-size:10px;color:#718c7c;font-weight:400;margin-top:5px}dialog{width:min(700px,calc(100vw - 30px));border:1px solid var(--line);border-radius:14px;padding:28px;color:var(--ink);max-height:90vh}dialog::backdrop{background:#102d29a6}.dialog-heading{display:flex;justify-content:space-between;gap:20px;margin-bottom:10px}.dialog-heading h2{font-size:26px}.icon-button{font-size:26px;background:none;color:#728b7d;align-self:start}.dialog-actions{display:flex;justify-content:flex-end;margin-top:24px}.check{display:flex;gap:10px;align-items:flex-start;font-size:12px;font-weight:400;line-height:1.5;margin-top:18px}.check input{width:17px;margin:2px 0}#invoiceFields{margin-top:20px;border-top:1px solid var(--line);padding-top:20px}.setup-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.setup-grid form{padding:24px}.setup-grid label{margin-bottom:15px}.setup-grid h3{font-size:15px}.field-stack{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field-stack label{margin-bottom:0}.field-stack .full{grid-column:1/-1}.section-gap{margin-top:22px}footer{font-size:10px;color:#809289;margin-top:25px;line-height:1.6}[hidden]{display:none!important}@media(max-width:1120px){.content{padding:28px 24px}.topbar{padding:20px 24px}.workspace{grid-template-columns:205px 1fr}.kpi-grid{grid-template-columns:repeat(2,1fr)}.dashboard-grid{grid-template-columns:1fr}.login-story{padding:45px}.login-story .brand{left:45px}.setup-grid{grid-template-columns:1fr}}@media(max-width:720px){.login-view{grid-template-columns:1fr}.login-story{min-height:400px;padding:100px 28px 60px}.login-story .brand{top:26px;left:28px}.login-story h1{font-size:38px}.story-foot{bottom:25px}.login-panel{padding:40px 26px}.workspace{display:block}.sidebar{position:static;height:auto;padding:20px}.sidebar .brand{margin-bottom:16px}.workspace-label,.tenant-name,.sidebar-bottom,.security-mark{display:none}.sidebar nav{display:flex;flex-wrap:wrap;gap:5px}.nav{width:auto;padding:8px 10px;font-size:11px}.topbar{padding:15px 20px;min-height:60px}.topbar .workspace-label{display:none}.content{padding:24px 18px}.page-heading{align-items:flex-start}.page-heading h1{font-size:27px}.page-heading .outline{white-space:nowrap}.kpi-grid{gap:10px}.kpi{padding:17px}.kpi-number{font-size:30px}.account{font-size:11px}.form-grid,.field-stack{grid-template-columns:1fr}.full{grid-column:auto}.card-body{padding:18px}.trust-row{gap:13px}.card-head{padding:17px}.setup-grid{display:block}.setup-grid .card{margin-bottom:18px}dialog{padding:20px}.sidebar-bottom{display:flex;margin-top:14px}.sidebar-bottom a{display:none}.sidebar-bottom .outline{padding:5px 10px;font-size:10px}}

````


## scale-api/scripts/backup.mjs

````javascript
/** Operator-only PostgreSQL schema backup. Requires pg_dump on PATH and a separately
 * supplied BACKUP_DATABASE_URL whose role can see ALL tenant rows (RLS included).
 * This is not a backup of S3 evidence; preserve pinned object versions separately.
 */
import { spawn } from 'node:child_process';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
const raw = process.env.BACKUP_DATABASE_URL;
if (!raw)
    throw Error('Set a dedicated BACKUP_DATABASE_URL. Never use the API role for cross-tenant backup.');
const u = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(u.protocol))
    throw Error('PostgreSQL URL required.');
for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    if (u.searchParams.has(key))
        throw Error('Configure backup TLS with DB_SSL / DB_CA_FILE, not URL parameters.');
if (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'true')
    throw Error('Production backups require verified TLS.');
const directory = resolve(process.env.BACKUP_DIRECTORY || 'backups');
await mkdir(directory, { recursive: true, mode: 0o700 });
const output = resolve(directory, 'carbonsynq-cs-' + new Date().toISOString().replaceAll(':', '-') + '.dump');
const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGDATABASE: decodeURIComponent(u.pathname.slice(1)), PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: process.env.DB_SSL === 'true' ? 'verify-full' : 'disable', ...(process.env.DB_CA_FILE ? { PGSSLROOTCERT: process.env.DB_CA_FILE } : {}) };
const child = spawn('pg_dump', ['--format=custom', '--schema=cs', '--no-owner', '--no-acl', '--file', output], { env, stdio: ['ignore', 'ignore', 'inherit'] });
const code = await new Promise((ok, fail) => { child.on('error', fail); child.on('exit', ok); });
if (code !== 0)
    throw Error('pg_dump failed. Treat any partial output as invalid; no successful backup is claimed.');
await chmod(output, 0o600);
console.log(JSON.stringify({ databaseBackup: output, includesObjectBytes: false, encryptedByApplication: false, restoreTested: false, note: 'Protect with encryption and test restoration with matching S3 object versions. Grants/roles require separate recreation.' }));

````


## scale-api/scripts/check.mjs

````javascript
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
let checked = 0;
for (const dir of ['src', 'scripts', 'tests', 'public'])
    for (const f of await readdir(new URL(dir + '/', root))) {
        if (!f.endsWith('.mjs') && !f.endsWith('.js'))
            continue;
        const r = spawnSync(process.execPath, ['--check', path.join(fileURLToPath(root), dir, f)], { encoding: 'utf8' });
        if (r.status !== 0) {
            console.error(r.stderr);
            process.exit(1);
        }
        checked++;
    }
const api = JSON.parse(await readFile(new URL('docs/openapi.json', root), 'utf8'));
if (api.openapi !== '3.1.0' || !api.paths['/api/v2/activities'])
    throw Error('OpenAPI contract incomplete.');
console.log(JSON.stringify({ syntaxFilesChecked: checked, openApiPaths: Object.keys(api.paths).length }));

````


## scale-api/scripts/load-smoke.mjs

````javascript
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

````


## scale-api/scripts/migrate.mjs

````javascript
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export async function migrate(ownerUrl, { apiPassword, workerPassword, ssl = false } = {}) {
    if (!ownerUrl)
        throw Error('DATABASE_OWNER_URL is required.');
    const parsed = new URL(ownerUrl);
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
        if (parsed.searchParams.has(key))
            throw Error('Use DB_SSL/DB_CA_FILE instead of database URL SSL parameters.');
    if (!apiPassword || !workerPassword || apiPassword.length < 24 || workerPassword.length < 24)
        throw Error('DB_API_PASSWORD and DB_WORKER_PASSWORD must be at least 24 characters.');
    const { Client } = await import('pg');
    const client = new Client({ connectionString: ownerUrl, ssl });
    await client.connect();
    const literal = s => "'" + s.replaceAll("'", "''") + "'";
    try {
        await client.query("SELECT pg_advisory_lock(hashtextextended('carbonsynq:migrations',0))");
        // Roles are cluster-wide, while all application tables live in the new cs schema.
        // This creates missing roles only; it never silently rotates existing role passwords.
        for (const [name, password] of [['cs_api', apiPassword], ['cs_worker', workerPassword]]) {
            const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount;
            if (!exists)
                await client.query(`CREATE ROLE ${name} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${literal(password)}`);
        }
        const sql = await readFile(new URL('../migrations/001_core.sql', import.meta.url), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const table = (await client.query("SELECT to_regclass('cs.schema_migrations') AS name")).rows[0].name;
        if (table) {
            const old = (await client.query('SELECT checksum FROM cs.schema_migrations WHERE version=1')).rows[0];
            if (!old || old.checksum !== checksum)
                throw Error('Migration history mismatch: do not edit applied migrations. Restore the file or create a new migration.');
            return { version: 1, alreadyApplied: true };
        }
        await client.query('BEGIN');
        try {
            await client.query(sql);
            await client.query('INSERT INTO cs.schema_migrations(version,checksum) VALUES(1,$1)', [checksum]);
            await client.query('COMMIT');
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        return { version: 1, alreadyApplied: false };
    }
    finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended('carbonsynq:migrations',0))").catch(() => { });
        await client.end();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: true, ...(process.env.DB_CA_FILE ? { ca: await readFile(process.env.DB_CA_FILE, 'utf8') } : {}) } : false;
    if (process.env.NODE_ENV === 'production' && !ssl)
        throw Error('Production migrations require verified database TLS.');
    console.log(JSON.stringify(await migrate(process.env.DATABASE_OWNER_URL, { apiPassword: process.env.DB_API_PASSWORD, workerPassword: process.env.DB_WORKER_PASSWORD, ssl })));
}

````


## scale-api/scripts/provision.mjs

````javascript
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
const client = new Client({ connectionString: process.env.DATABASE_OWNER_URL, ssl });
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

````


## scale-api/scripts/setup-env.mjs

````javascript
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
`;
writeFileSync(target, content, { mode: 0o600, flag: 'wx' });
console.log('Created scale-api/.env with random local secrets. Run docker compose up --build -d.');

````


## scale-api/scripts/storage-check.mjs

````javascript
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

````


## scale-api/src/activities.mjs

````javascript
import { id, uuid, role, WRITERS, fail, activityInput, fingerprint, version, workflow, pagination, page, text, decimal } from './core.mjs';
import { tenantTx, audit, idempotent, enqueue } from './db.mjs';
export async function openPeriod(c, tenantId, periodId) {
    const p = (await c.query('SELECT * FROM cs.periods WHERE tenant_id=$1 AND id=$2 FOR SHARE', [tenantId, periodId])).rows[0];
    if (!p)
        fail(422, 'INVALID_PERIOD', 'Period does not belong to this tenant.');
    if (p.status !== 'OPEN')
        fail(409, 'PERIOD_LOCKED', 'Reporting period is locked.');
    return p;
}
export async function validateReferences(c, user, a) {
    const p = await openPeriod(c, user.tenant_id, a.periodId);
    if (a.activityDate < p.start_date || a.activityDate > p.end_date)
        fail(422, 'DATE_OUTSIDE_PERIOD', 'Activity date must fall within the selected period.');
    const campus = (await c.query('SELECT id FROM cs.campuses WHERE tenant_id=$1 AND id=$2', [user.tenant_id, a.campusId])).rows[0];
    if (!campus)
        fail(422, 'INVALID_CAMPUS', 'Campus does not belong to this tenant.');
    if (a.buildingId) {
        const b = (await c.query('SELECT id FROM cs.buildings WHERE tenant_id=$1 AND campus_id=$2 AND id=$3', [user.tenant_id, a.campusId, a.buildingId])).rows[0];
        if (!b)
            fail(422, 'INVALID_BUILDING', 'Building does not belong to this campus.');
    }
}
export async function insertActivity(c, user, a, evidence = {}) {
    const row = (await c.query(`INSERT INTO cs.activities(id,tenant_id,period_id,campus_id,building_id,category,scope,unit,quantity,activity_date,description,input_source,document_id,amount_inr,vendor,invoice_number,fingerprint,duplicate_slot,duplicate_reason,created_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`, [id(), user.tenant_id, a.periodId, a.campusId, a.buildingId, a.category, a.scope, a.unit, a.quantity, a.activityDate, a.description, evidence.documentId ? 'INVOICE' : 'MANUAL', evidence.documentId || null, evidence.amountInr || null, evidence.vendor || null, evidence.invoiceNumber || null, fingerprint(a), a.duplicateReason ? id() : '', a.duplicateReason, user.id])).rows[0];
    await audit(c, user, 'ACTIVITY_CREATED', row.id, { source: row.input_source, quantity: row.quantity, unit: row.unit, duplicateReason: a.duplicateReason });
    return row;
}
export async function createActivity(pool, user, body, key) {
    role(user, WRITERS);
    const a = activityInput(body);
    return tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'activities.create', key, body, async () => { await validateReferences(c, user, a); return insertActivity(c, user, a); }));
}
export async function getActivity(pool, user, activityId) {
    uuid(activityId);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const a = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2', [user.tenant_id, activityId])).rows[0];
        if (!a)
            fail(404, 'NOT_FOUND', 'Activity not found.');
        a.calculation = (await c.query('SELECT * FROM cs.calculations WHERE tenant_id=$1 AND activity_id=$2', [user.tenant_id, activityId])).rows[0] || null;
        return a;
    });
}
export async function listActivities(pool, user, query) {
    const { limit, cursor } = pagination(query);
    const params = [user.tenant_id, limit + 1];
    const filters = ['tenant_id=$1'];
    if (cursor) {
        params.push(...cursor);
        filters.push('(created_at,id)<($3::timestamptz,$4::uuid)');
    }
    for (const [key, col] of [['periodId', 'period_id'], ['campusId', 'campus_id'], ['status', 'status']])
        if (query[key]) {
            params.push(key === 'status' ? text(query[key], key, 30) : uuid(query[key]));
            filters.push(`${col}=$${params.length}`);
        }
    return tenantTx(pool, user.tenant_id, async (c) => page((await c.query(`SELECT * FROM cs.activities WHERE ${filters.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT $2`, params)).rows, limit));
}
export async function editActivity(pool, user, activityId, body) {
    role(user, WRITERS);
    uuid(activityId);
    const a = activityInput(body);
    return tenantTx(pool, user.tenant_id, async (c) => {
        // Lock both period rows in UUID order before the activity, avoiding opposing edits deadlocking.
        const seen = (await c.query('SELECT period_id FROM cs.activities WHERE tenant_id=$1 AND id=$2', [user.tenant_id, activityId])).rows[0];
        if (!seen)
            fail(404, 'NOT_FOUND', 'Activity not found.');
        for (const pid of [...new Set([seen.period_id, a.periodId])].sort())
            await openPeriod(c, user.tenant_id, pid);
        const old = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, activityId])).rows[0];
        version(old, body.version);
        if (old.period_id !== seen.period_id)
            fail(409, 'STALE_VERSION', 'Period changed. Reload the activity.');
        if (!['DRAFT', 'REJECTED'].includes(old.status))
            fail(409, 'INVALID_STATE', 'Only draft or rejected records can be edited.');
        if (user.role !== 'ADMIN' && old.created_by !== user.id)
            fail(403, 'NOT_OWNER', 'Only the owner or admin can edit.');
        await validateReferences(c, user, a);
        const row = (await c.query(`UPDATE cs.activities SET period_id=$3,campus_id=$4,building_id=$5,category=$6,scope=$7,unit=$8,quantity=$9,activity_date=$10,description=$11,fingerprint=$12,duplicate_slot=$13,duplicate_reason=$14,status='DRAFT',factor_id=NULL,verified_by=NULL,rejection_reason=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [user.tenant_id, activityId, a.periodId, a.campusId, a.buildingId, a.category, a.scope, a.unit, a.quantity, a.activityDate, a.description, fingerprint(a), a.duplicateReason ? (old.duplicate_slot || id()) : '', a.duplicateReason])).rows[0];
        await audit(c, user, 'ACTIVITY_EDITED', activityId, { before: old, after: row });
        return row;
    });
}
export async function transition(pool, user, activityId, action, body) {
    uuid(activityId);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const seen = (await c.query('SELECT period_id FROM cs.activities WHERE tenant_id=$1 AND id=$2', [user.tenant_id, activityId])).rows[0];
        if (!seen)
            fail(404, 'NOT_FOUND', 'Activity not found.');
        await openPeriod(c, user.tenant_id, seen.period_id);
        const old = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, activityId])).rows[0];
        if (old.period_id !== seen.period_id)
            fail(409, 'STALE_VERSION', 'Record changed. Reload it.');
        const next = workflow(old, action, user, body);
        let factorId = old.factor_id;
        if (action === 'verify') {
            factorId = uuid(body.factorId, 'factorId');
            const f = (await c.query(`SELECT * FROM cs.factors WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'`, [user.tenant_id, factorId])).rows[0];
            if (!f || f.category !== old.category || f.unit !== old.unit || f.scope !== old.scope || old.activity_date < f.valid_from || old.activity_date > f.valid_to)
                fail(422, 'INVALID_FACTOR', 'Select an approved factor with matching category, unit, scope and validity dates.');
        }
        const row = (await c.query('UPDATE cs.activities SET status=$3,verified_by=$4,factor_id=$5,rejection_reason=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [user.tenant_id, activityId, next.status, action === 'verify' ? user.id : old.verified_by, factorId, next.reason])).rows[0];
        if (action === 'verify')
            await enqueue(c, user.tenant_id, 'CALCULATE', activityId);
        await audit(c, user, 'ACTIVITY_' + next.status, activityId, { beforeStatus: old.status, version: row.version, reason: next.reason, factorId });
        return row;
    });
}
export async function confirmInvoice(pool, user, documentId, body, key) {
    role(user, WRITERS);
    uuid(documentId);
    const a = activityInput(body);
    if (body.reviewConfirmed !== true)
        fail(422, 'REVIEW_REQUIRED', 'A person must check the original invoice and confirm actual consumption.');
    const vendor = text(body.vendor, 'vendor', 150), invoiceNumber = text(body.invoiceNumber, 'invoiceNumber', 80);
    const amountInr = body.amountInr === undefined || body.amountInr === null || body.amountInr === '' ? null : decimal(body.amountInr, 'amountInr', 2, true);
    return tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'invoice.confirm:' + documentId, key, body, async () => {
        await validateReferences(c, user, a);
        const doc = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, documentId])).rows[0];
        if (!doc)
            fail(404, 'NOT_FOUND', 'Document not found.');
        version(doc, body.version);
        if (doc.status !== 'REVIEW_REQUIRED' || doc.scan_result !== 'CLEAN')
            fail(409, 'INVOICE_NOT_READY', 'Invoice must pass scanning before human review.');
        const invoiceKey = vendor.toLowerCase().replace(/\s+/g, ' ') + '|' + invoiceNumber.toUpperCase().replace(/\s+/g, '');
        const row = await insertActivity(c, user, a, { documentId, amountInr, vendor, invoiceNumber });
        await c.query("UPDATE cs.documents SET status='LINKED',invoice_key=$3,reviewed=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2", [user.tenant_id, documentId, invoiceKey, JSON.stringify({ vendor, invoiceNumber, amountInr, activityId: row.id, consumption: a.quantity, unit: a.unit, confirmedBy: user.id })]);
        await audit(c, user, 'INVOICE_CONFIRMED', documentId, { activityId: row.id });
        return row;
    }));
}

````


## scale-api/src/auth.mjs

````javascript
import { hash, uuid, text, fail, passwordVerify, passwordHash, sessionToken, parseToken } from './core.mjs';
import { tenantTx, audit } from './db.mjs';
const DUMMY = 'scrypt$' + '0'.repeat(32) + '$' + '0'.repeat(128);
export async function rateLimit(pool, key, max, seconds) {
    const r = (await pool.query(`INSERT INTO cs.rate_buckets(bucket_key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second')
    ON CONFLICT(bucket_key) DO UPDATE SET hits=CASE WHEN cs.rate_buckets.expires_at<=now() THEN 1 ELSE cs.rate_buckets.hits+1 END,
    expires_at=CASE WHEN cs.rate_buckets.expires_at<=now() THEN now()+$2*interval '1 second' ELSE cs.rate_buckets.expires_at END RETURNING hits`, [hash(key), seconds])).rows[0];
    if (r.hits > max)
        fail(429, 'RATE_LIMITED', 'Too many requests. Retry after the rate window.');
}
export async function login(pool, body, ip, sessionHours = 8) {
    await rateLimit(pool, 'login-ip:' + ip, 30, 900);
    const tenantId = uuid(body.tenantId, 'tenantId');
    const email = text(body.email, 'email', 254).toLowerCase();
    await rateLimit(pool, `login-account:${tenantId}:${email}`, 10, 900);
    const row = await tenantTx(pool, tenantId, async (c) => (await c.query(`SELECT u.*,t.status AS tenant_status FROM cs.users u JOIN cs.tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.email=$2`, [tenantId, email])).rows[0]);
    const ok = await passwordVerify(body.password, row?.password_hash || DUMMY);
    if (!ok || !row?.active || row.tenant_status !== 'ACTIVE')
        fail(401, 'INVALID_CREDENTIALS', 'Tenant, email or password is incorrect.');
    const token = sessionToken(tenantId);
    await tenantTx(pool, tenantId, async (c) => {
        // Prevent a login racing password reset or account suspension from minting a valid session.
        const current = (await c.query('SELECT u.*,t.status AS tenant_status FROM cs.users u JOIN cs.tenants t ON t.id=u.tenant_id WHERE u.tenant_id=$1 AND u.id=$2 FOR SHARE OF u,t', [tenantId, row.id])).rows[0];
        if (!current?.active || current.tenant_status !== 'ACTIVE' || current.password_hash !== row.password_hash)
            fail(401, 'INVALID_CREDENTIALS', 'Account changed. Sign in again.');
        await c.query(`INSERT INTO cs.sessions(tenant_id,token_hash,user_id,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 hour')`, [tenantId, hash(token), row.id, sessionHours]);
        await audit(c, row, 'LOGIN', row.id);
    });
    return { token, expiresInSeconds: sessionHours * 3600, user: publicUser(row) };
}
export function publicUser(r) { return { id: r.id, tenantId: r.tenant_id, name: r.name, email: r.email, role: r.role }; }
export async function authenticate(pool, header) {
    const { tenantId, tokenHash } = parseToken(header);
    const user = await tenantTx(pool, tenantId, async (c) => (await c.query(`SELECT u.* FROM cs.sessions s JOIN cs.users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id JOIN cs.tenants t ON t.id=u.tenant_id WHERE s.tenant_id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND u.active AND t.status='ACTIVE'`, [tenantId, tokenHash])).rows[0]);
    if (!user)
        fail(401, 'UNAUTHENTICATED', 'Session expired or revoked. Sign in again.');
    delete user.password_hash;
    user.tokenHash = tokenHash;
    return user;
}
export async function logout(pool, user) {
    return tenantTx(pool, user.tenant_id, async (c) => { await c.query('DELETE FROM cs.sessions WHERE tenant_id=$1 AND token_hash=$2', [user.tenant_id, user.tokenHash]); await audit(c, user, 'LOGOUT', user.id); return { loggedOut: true }; });
}
export async function changePassword(pool, user, body) {
    const old = await tenantTx(pool, user.tenant_id, async (c) => (await c.query('SELECT password_hash FROM cs.users WHERE tenant_id=$1 AND id=$2', [user.tenant_id, user.id])).rows[0]);
    if (!await passwordVerify(body.currentPassword, old?.password_hash))
        fail(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    const encoded = await passwordHash(body.newPassword);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const changed = await c.query('UPDATE cs.users SET password_hash=$1 WHERE tenant_id=$2 AND id=$3 AND password_hash=$4 RETURNING id', [encoded, user.tenant_id, user.id, old.password_hash]);
        if (!changed.rowCount)
            fail(409, 'ACCOUNT_CHANGED', 'Account changed. Sign in again.');
        await c.query('DELETE FROM cs.sessions WHERE tenant_id=$1 AND user_id=$2', [user.tenant_id, user.id]);
        await audit(c, user, 'PASSWORD_CHANGED', user.id);
        return { sessionsRevoked: true };
    });
}

````


## scale-api/src/config.mjs

````javascript
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
    return { production, databaseUrl, ssl, poolMax: integer('DB_POOL_MAX', 10, 1, 50), host: env.HOST || '127.0.0.1', port: integer('PORT', 8080, 1024, 65535), origins, metricsToken,
        maxUploadBytes: integer('MAX_UPLOAD_BYTES', 10485760, 1024, 10485760), maxInflight: integer('MAX_INFLIGHT_REQUESTS', 64, 1, 512), maxUploads: integer('MAX_INFLIGHT_UPLOADS', 4, 1, 16),
        bucket: required('S3_BUCKET'), region: env.AWS_REGION || 'us-east-1', endpoint, forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
        clamHost: env.CLAMAV_HOST || '127.0.0.1', clamPort: integer('CLAMAV_PORT', 3310, 1, 65535), workerPollMs: integer('WORKER_POLL_MS', 1000, 100, 60000),
        leaseSeconds: integer('JOB_LEASE_SECONDS', 180, 120, 900), scanTimeoutMs: integer('SCAN_TIMEOUT_MS', 45000, 1000, 60000),
        trustProxy: env.TRUST_PROXY === 'true', sessionHours: integer('SESSION_HOURS', 8, 1, 24) };
}

````


## scale-api/src/core.mjs

````javascript
import { randomUUID, createHash, randomBytes, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(rawScrypt);
export const id = randomUUID;
export const hash = x => createHash('sha256').update(x).digest('hex');
export class AppError extends Error {
    constructor(status, code, message, details) { super(message); Object.assign(this, { status, code, details }); }
}
export function fail(status, code, message, details) { throw new AppError(status, code, message, details); }
export function object(x) { if (!x || typeof x !== 'object' || Array.isArray(x))
    fail(422, 'INVALID_OBJECT', 'Expected a JSON object.'); return x; }
export function text(x, name, max = 200, optional = false) {
    if (optional && (x === undefined || x === null || x === ''))
        return null;
    if (typeof x !== 'string' || !x.trim() || x.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x))
        fail(422, 'INVALID_FIELD', `${name} is required and must be at most ${max} characters.`);
    return x.trim();
}
export function uuid(x, name = 'id') { if (typeof x !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x))
    fail(422, 'INVALID_ID', `${name} must be a UUID.`); return x.toLowerCase(); }
export function day(x, name = 'date') {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(Date.parse(x)) || new Date(x).toISOString().slice(0, 10) !== x)
        fail(422, 'INVALID_DATE', `${name} must be a real YYYY-MM-DD date.`);
    return x;
}
// All quantities, factors and totals travel as decimal strings. No floating point arithmetic.
export function decimal(x, name = 'quantity', precision = 6, allowZero = false) {
    if (typeof x !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,${precision}})?$`).test(x))
        fail(422, 'INVALID_DECIMAL', `${name} must be a decimal STRING, at most 12 integer digits and ${precision} fractional digits.`);
    const [a, b = ''] = x.split('.');
    if (!allowZero && BigInt(a + b.padEnd(precision, '0')) === 0n)
        fail(422, 'INVALID_DECIMAL', `${name} must be positive.`);
    return a + '.' + b.padEnd(precision, '0');
}
export function multiplyDecimals(quantity, factor) {
    const q = decimal(quantity, 'quantity', 6).replace('.', '');
    const f = decimal(factor, 'factor', 9).replace('.', '');
    const product = BigInt(q) * BigInt(f); // 15 fractional digits, rounded half-up to 6.
    const rounded = (product + 500000000n) / 1000000000n;
    const s = rounded.toString().padStart(7, '0');
    return s.slice(0, -6) + '.' + s.slice(-6);
}
export function canonical(x) {
    if (Array.isArray(x))
        return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object')
        return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
    return JSON.stringify(x);
}
export function role(user, allowed) { if (!allowed.includes(user.role))
    fail(403, 'FORBIDDEN', 'Your role cannot perform this action.'); }
export const WRITERS = ['ADMIN', 'ENTRY'];
export const REVIEWERS = ['ADMIN', 'REVIEWER'];
export const CATEGORIES = Object.freeze({ PURCHASED_ELECTRICITY: ['SCOPE_2', 'kWh'], DIESEL: ['SCOPE_1', 'litre'], PETROL: ['SCOPE_1', 'litre'], LPG: ['SCOPE_1', 'kg'], NATURAL_GAS: ['SCOPE_1', 'm3'] });
export function activityInput(x) {
    object(x);
    if ('tenantId' in x || 'universityId' in x || 'scope' in x)
        fail(422, 'SERVER_OWNED_FIELD', 'Tenant and scope are determined by the server.');
    const category = text(x.category, 'category', 60);
    const spec = CATEGORIES[category];
    if (!spec || x.unit !== spec[1])
        fail(422, 'UNIT_MISMATCH', 'Use the canonical unit for a supported category.');
    const a = { periodId: uuid(x.periodId, 'periodId'), campusId: uuid(x.campusId, 'campusId'), buildingId: x.buildingId ? uuid(x.buildingId, 'buildingId') : null,
        category, scope: spec[0], unit: spec[1], quantity: decimal(x.quantity), activityDate: day(x.activityDate), description: text(x.description, 'description', 2000, true) || '',
        duplicateReason: text(x.duplicateReason, 'duplicateReason', 500, true) };
    if (a.duplicateReason && a.duplicateReason.length < 10)
        fail(422, 'DUPLICATE_REASON', 'Explain the separate consumption record in at least 10 characters.');
    return a;
}
export function fingerprint(a) { return hash(canonical([a.periodId, a.campusId, a.buildingId, a.category, a.unit, a.quantity, a.activityDate])); }
export function version(row, x) { if (!Number.isInteger(x) || x !== row.version)
    fail(409, 'STALE_VERSION', 'Refresh this record and retry with its current version.'); }
export function workflow(row, action, user, body) {
    version(row, body.version);
    if (action === 'submit') {
        role(user, WRITERS);
        if (user.role !== 'ADMIN' && row.created_by !== user.id)
            fail(403, 'NOT_OWNER', 'Only the owner or admin may submit.');
    }
    else
        role(user, REVIEWERS);
    const next = { submit: ['DRAFT', 'SUBMITTED'], 'start-review': ['SUBMITTED', 'UNDER_REVIEW'], verify: ['UNDER_REVIEW', 'VERIFIED'] }[action];
    if (action === 'reject') {
        if (!['SUBMITTED', 'UNDER_REVIEW'].includes(row.status))
            fail(409, 'INVALID_STATE', 'Only pending review records can be rejected.');
        const reason = text(body.reason, 'reason', 1000);
        if (reason.length < 5)
            fail(422, 'REASON_REQUIRED', 'Provide a useful rejection reason.');
        return { status: 'REJECTED', reason };
    }
    if (!next || row.status !== next[0])
        fail(409, 'INVALID_STATE', 'This transition is not valid for the current status.');
    if (action === 'verify' && row.created_by === user.id)
        fail(403, 'SELF_APPROVAL', 'A different person must approve this activity.');
    return { status: next[1], reason: null };
}
export function pagination(query) {
    const limit = Number(query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(422, 'INVALID_LIMIT', 'limit must be 1 to 100.');
    let cursor = null;
    if (query.cursor) {
        try {
            cursor = JSON.parse(Buffer.from(text(query.cursor, 'cursor', 512), 'base64url').toString());
            day(cursor[0].slice(0, 10));
            uuid(cursor[1]);
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor[0]))
                throw Error();
        }
        catch {
            fail(422, 'INVALID_CURSOR', 'Invalid pagination cursor.');
        }
    }
    return { limit, cursor };
}
export function page(rows, limit) { const more = rows.length > limit; const items = rows.slice(0, limit); const last = items.at(-1); return { items, nextCursor: more ? Buffer.from(JSON.stringify([new Date(last.created_at).toISOString(), last.id])).toString('base64url') : null }; }
export async function passwordHash(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128)
        fail(422, 'PASSWORD_POLICY', 'Use a password of 12 to 128 characters.');
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `scrypt$${salt}$${key.toString('hex')}`;
}
export async function passwordVerify(password, encoded) {
    const [, salt, key] = String(encoded).split('$');
    if (!/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(key || '') || typeof password !== 'string' || password.length > 128)
        return false;
    const actual = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(Buffer.from(key, 'hex'), actual);
}
export function sessionToken(tenantId) { return `${uuid(tenantId)}.${randomBytes(32).toString('base64url')}`; }
export function parseToken(header) {
    const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(header || '');
    if (!match)
        fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    try {
        return { tenantId: uuid(match[1]), tokenHash: hash(match[1] + '.' + match[2]) };
    }
    catch {
        fail(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
}
export function idempotencyKey(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value))
    fail(422, 'IDEMPOTENCY_REQUIRED', 'Send an Idempotency-Key of 8 to 128 safe characters.'); return value; }
export function errorResponse(error, requestId) {
    if (error instanceof AppError)
        return { status: error.status, body: { success: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }, requestId } };
    const known = { 'STORAGE_UNCERTAIN': [503, 'UPLOAD_PENDING', 'The upload outcome is pending. Retry the same request and key; do not create a new upload.'], '40001': [409, 'RETRY_TRANSACTION', 'Concurrent change. Retry safely with the same idempotency key.'], '40P01': [409, 'RETRY_TRANSACTION', 'Concurrent change. Retry safely with the same idempotency key.'], '23505': [409, 'CONFLICT', 'A matching record already exists.'], '23503': [422, 'INVALID_REFERENCE', 'A referenced record is not valid.'], '23514': [422, 'CONSTRAINT', 'A data constraint was not satisfied.'], '42501': [403, 'FORBIDDEN', 'Operation is not authorized.'], '57014': [503, 'BUSY', 'The request timed out. Retry safely using the same idempotency key.'], '55P03': [503, 'BUSY', 'The record is busy. Retry shortly.'] };
    const k = known[error?.code] || [500, 'INTERNAL_ERROR', 'Request failed. Use the request ID when contacting support.'];
    return { status: k[0], body: { success: false, error: { code: k[1], message: k[2] }, requestId } };
}

````


## scale-api/src/db.mjs

````javascript
import { createHmac } from 'node:crypto';
import { uuid, fail, hash, canonical, idempotencyKey } from './core.mjs';
export async function createPool(config) {
    const { Pool, types } = await import('pg');
    // Keep calendar dates and exact NUMERIC values as strings.
    types.setTypeParser(1082, x => x);
    const pool = new Pool({ connectionString: config.databaseUrl, ssl: config.ssl, max: config.poolMax, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: 'carbonsynq-scale', statement_timeout: 15000, query_timeout: 20000 });
    pool.on('error', err => console.error(JSON.stringify({ event: 'db_pool_error', code: err.code || 'UNKNOWN' })));
    return pool;
}
export async function tenantTx(pool, tenantId, fn) {
    uuid(tenantId, 'tenantId');
    const client = await pool.connect();
    let broken = false;
    try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
        await client.query("SET LOCAL lock_timeout = '5s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '25s'");
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        try {
            await client.query('ROLLBACK');
        }
        catch {
            broken = true;
        }
        throw error;
    }
    finally {
        client.release(broken);
    }
}
export async function assertRuntimeRole(pool, worker = false) {
    const r = (await pool.query(`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
    if (!r || r.rolsuper || r.rolbypassrls || r.name !== (worker ? 'cs_worker' : 'cs_api'))
        throw Error('Runtime must use the dedicated non-owner cs_api/cs_worker role, never the migration owner.');
    const owned = (await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='cs' AND tableowner=current_user LIMIT 1")).rows;
    if (owned.length)
        throw Error('Runtime roles must not own tables.');
}
export async function audit(c, actor, action, entityId, details = {}) {
    await c.query(`INSERT INTO cs.audit_events(tenant_id,actor_id,action,entity_id,details,request_id) VALUES($1,$2,$3,$4,$5,$6)`, [actor.tenant_id, actor.id || null, action, entityId, JSON.stringify(details), actor.requestId || null]);
}
export async function idempotent(c, user, route, key, input, fn) {
    idempotencyKey(key);
    const secret = process.env.REQUEST_HASH_SECRET;
    if (!secret || secret.length < 32)
        throw Error('REQUEST_HASH_SECRET must be at least 32 characters.');
    const digest = createHmac('sha256', secret).update(canonical(input)).digest('hex');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${user.tenant_id}:${user.id}:${route}:${key}`]);
    const existing = (await c.query(`SELECT request_hash,response FROM cs.idempotency_keys WHERE tenant_id=$1 AND actor_id=$2 AND route=$3 AND request_key=$4 AND expires_at>now()`, [user.tenant_id, user.id, route, key])).rows[0];
    if (existing) {
        if (existing.request_hash !== digest)
            fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used with a different request.');
        return existing.response;
    }
    const response = await fn();
    await c.query(`INSERT INTO cs.idempotency_keys(tenant_id,actor_id,route,request_key,request_hash,response,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours') ON CONFLICT(tenant_id,actor_id,route,request_key) DO UPDATE SET request_hash=EXCLUDED.request_hash,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`, [user.tenant_id, user.id, route, key, digest, JSON.stringify(response)]);
    return response;
}
export async function enqueue(c, tenantId, kind, entityId, delaySeconds = 0, suffix = '') {
    await c.query(`INSERT INTO cs.jobs(tenant_id,kind,entity_id,dedupe_key,available_at) VALUES($1,$2,$3,$4,now()+$5*interval '1 second') ON CONFLICT(tenant_id,dedupe_key) DO NOTHING`, [tenantId, kind, entityId, `${kind}:${entityId}${suffix}`, delaySeconds]);
}

````


## scale-api/src/documents.mjs

````javascript
import { id, uuid, role, WRITERS, fail, hash } from './core.mjs';
import { tenantTx, idempotent, audit, enqueue } from './db.mjs';
import { validateUpload } from './storage.mjs';
export function publicDocument(d) {
    const { object_key, object_version, upload_deadline, quota_reserved, ...safe } = d;
    return safe;
}
export async function upload(pool, storage, user, filename, mime, bytes, key, maxBytes = 10485760) {
    role(user, WRITERS);
    const f = validateUpload(filename, mime, bytes, maxBytes);
    const candidate = id();
    // Reserve quota and document before external I/O. An upload is a durable two-phase operation.
    const reservation = await tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'documents.upload', key, f, async () => {
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [user.tenant_id + ':file:' + f.sha256]);
        const existing = (await c.query('SELECT id,status FROM cs.documents WHERE tenant_id=$1 AND sha256=$2', [user.tenant_id, f.sha256])).rows[0];
        if (existing)
            fail(409, 'DUPLICATE_FILE', 'This file already exists in your university.', { documentId: existing.id, status: existing.status });
        const quota = await c.query(`UPDATE cs.tenants SET storage_used_bytes=storage_used_bytes+$2 WHERE id=$1 AND status='ACTIVE' AND storage_used_bytes+$2<=storage_quota_bytes RETURNING id`, [user.tenant_id, f.size]);
        if (!quota.rowCount)
            fail(409, 'STORAGE_QUOTA', 'Storage quota exceeded or tenant suspended.');
        await c.query(`INSERT INTO cs.documents(id,tenant_id,original_name,mime_type,file_size,sha256,object_key,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [candidate, user.tenant_id, f.name, f.mime, f.size, f.sha256, `${user.tenant_id}/evidence/${candidate}`, user.id]);
        await enqueue(c, user.tenant_id, 'RECONCILE_UPLOAD', candidate, 300);
        await audit(c, user, 'UPLOAD_RESERVED', candidate, { sha256: f.sha256, bytes: f.size });
        return { id: candidate };
    }));
    // A retry returns the existing operation; it never races a second PUT against the first PUT.
    if (reservation.id !== candidate)
        return getDocument(pool, user, reservation.id);
    let stored;
    try {
        stored = await storage.put(`${user.tenant_id}/evidence/${candidate}`, bytes, f.mime);
    }
    catch (error) {
        // Keep UPLOADING: a timeout does not prove that S3 failed to persist the object.
        // Maintenance reconciles the exact key and digest instead of deleting on an ambiguous failure.
        throw Object.assign(new Error('S3 upload outcome uncertain'), { code: 'STORAGE_UNCERTAIN', cause: error, documentId: candidate });
    }
    return tenantTx(pool, user.tenant_id, async (c) => {
        const doc = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, candidate])).rows[0];
        if (doc.status !== 'UPLOADING')
            fail(409, 'UPLOAD_EXPIRED', 'Upload reservation is no longer active. Ask an administrator to retry it.');
        const row = (await c.query("UPDATE cs.documents SET status='QUEUED',object_version=$3,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *", [user.tenant_id, candidate, stored.versionId])).rows[0];
        await enqueue(c, user.tenant_id, 'SCAN_INVOICE', candidate);
        await audit(c, user, 'UPLOAD_COMPLETED', candidate, { versionPinned: true });
        return publicDocument(row);
    });
}
export async function getDocument(pool, user, documentId) {
    uuid(documentId);
    return tenantTx(pool, user.tenant_id, async (c) => { const d = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2', [user.tenant_id, documentId])).rows[0]; if (!d)
        fail(404, 'NOT_FOUND', 'Document not found.'); return publicDocument(d); });
}
export async function download(pool, storage, user, documentId) {
    uuid(documentId);
    const d = await tenantTx(pool, user.tenant_id, async (c) => {
        const doc = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2', [user.tenant_id, documentId])).rows[0];
        if (!doc)
            fail(404, 'NOT_FOUND', 'Document not found.');
        if (!['REVIEW_REQUIRED', 'LINKED'].includes(doc.status) || doc.scan_result !== 'CLEAN')
            fail(409, 'QUARANTINED', 'This invoice has not passed the malware scan.');
        return doc;
    });
    const bytes = await storage.get(d.object_key, d.object_version, Number(d.file_size));
    if (bytes.length !== Number(d.file_size) || hash(bytes) !== d.sha256)
        fail(503, 'EVIDENCE_INTEGRITY', 'Stored evidence did not match its recorded digest.');
    await tenantTx(pool, user.tenant_id, c => audit(c, user, 'EVIDENCE_DOWNLOADED', documentId, { sha256: d.sha256 }));
    return { bytes, name: d.original_name, mime: d.mime_type };
}
export async function retryUpload(pool, storage, user, documentId, bytes, mime, filename, maxBytes) {
    role(user, ['ADMIN']);
    uuid(documentId);
    const f = validateUpload(filename, mime, bytes, maxBytes);
    // No blind overwrite of an active or accepted evidence object.
    const doc = await tenantTx(pool, user.tenant_id, async (c) => {
        const d = (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, documentId])).rows[0];
        if (!d)
            fail(404, 'NOT_FOUND', 'Document not found.');
        if (d.status !== 'UPLOAD_FAILED')
            fail(409, 'INVALID_STATE', 'Only reconciled failed uploads can be retried.');
        if (f.sha256 !== d.sha256 || f.mime !== d.mime_type)
            fail(422, 'DIGEST_MISMATCH', 'Retry with the exact original file.');
        const q = await c.query('UPDATE cs.tenants SET storage_used_bytes=storage_used_bytes+$2 WHERE id=$1 AND storage_used_bytes+$2<=storage_quota_bytes RETURNING id', [user.tenant_id, f.size]);
        if (!q.rowCount)
            fail(409, 'STORAGE_QUOTA', 'Storage quota exceeded.');
        const freshKey = `${user.tenant_id}/evidence/${id()}`;
        await c.query("UPDATE cs.documents SET status='UPLOADING',object_key=$3,object_version=NULL,quota_reserved=true,upload_deadline=now()+interval '5 minutes',version=version+1 WHERE tenant_id=$1 AND id=$2", [user.tenant_id, documentId, freshKey]);
        await enqueue(c, user.tenant_id, 'RECONCILE_UPLOAD', documentId, 300, freshKey);
        await audit(c, user, 'UPLOAD_RETRIED', documentId);
        return { ...d, object_key: freshKey };
    });
    const stored = await storage.put(doc.object_key, bytes, doc.mime_type);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const r = (await c.query("UPDATE cs.documents SET object_version=$3,status='QUEUED',version=version+1 WHERE tenant_id=$1 AND id=$2 AND status='UPLOADING' AND object_key=$4 RETURNING *", [user.tenant_id, documentId, stored.versionId, doc.object_key])).rows[0];
        if (!r)
            fail(409, 'UPLOAD_EXPIRED', 'Upload reservation changed.');
        await enqueue(c, user.tenant_id, 'SCAN_INVOICE', documentId);
        return publicDocument(r);
    });
}

````


## scale-api/src/extract-thread.mjs

````javascript
import { parentPort, workerData } from 'node:worker_threads';
import { extractInvoice } from './invoice-text.mjs';
parentPort.postMessage(extractInvoice(Buffer.from(workerData.bytes), workerData.mime));

````


## scale-api/src/http.mjs

````javascript
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
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
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
            if (!path.startsWith('/api/v2/'))
                fail(404, 'NOT_FOUND', 'Route not found.');
            const user = await services.authenticate(req.headers.authorization);
            user.requestId = requestId;
            await services.limit(user);
            // No tenant switching by query or caller-supplied university IDs.
            if ('tenantId' in query || 'universityId' in query)
                fail(422, 'SERVER_OWNED_FIELD', 'Tenant comes from the authenticated session.');
            const key = req.headers['idempotency-key'];
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

````


## scale-api/src/invoice-text.mjs

````javascript
// Reused conservative parser, executed ONLY in a bounded worker thread after scanning.
import { inflateSync } from "node:zlib";
function ascii85(value) {
    const s = value.toString('latin1').replace(/\s/g, '').replace(/^<~/, '').replace(/~>$/, '');
    const out = [];
    let group = [];
    for (const c of s) {
        if (c === 'z' && group.length === 0) {
            out.push(0, 0, 0, 0);
            continue;
        }
        const v = c.charCodeAt(0) - 33;
        if (v < 0 || v > 84)
            throw new Error('Unsupported ASCII85');
        group.push(v);
        if (group.length === 5) {
            let n = group.reduce((a, b) => a * 85 + b, 0);
            out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
            group = [];
        }
    }
    if (group.length > 1) {
        const count = group.length;
        while (group.length < 5)
            group.push(84);
        const n = group.reduce((a, b) => a * 85 + b, 0);
        out.push(...[(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].slice(0, count - 1));
    }
    return Buffer.from(out);
}
function literalStrings(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i] !== '(')
            continue;
        let result = '';
        let depth = 1;
        while (++i < s.length && depth) {
            let c = s[i];
            if (c === '\\') {
                c = s[++i];
                if (c === undefined)
                    break;
                if (/[0-7]/.test(c)) {
                    let oct = c;
                    for (let j = 0; j < 2 && /[0-7]/.test(s[i + 1] ?? 'x'); j++)
                        oct += s[++i];
                    result += String.fromCharCode(parseInt(oct, 8));
                }
                else if (c === 'n' || c === 'r')
                    result += ' ';
                else if (c === 't')
                    result += ' ';
                else if (c === '\r') {
                    if (s[i + 1] === '\n')
                        i++;
                }
                else if (c !== '\n')
                    result += c;
            }
            else if (c === '(') {
                depth++;
                result += c;
            }
            else if (c === ')') {
                depth--;
                if (depth)
                    result += c;
            }
            else
                result += c;
        }
        if (result.trim())
            out.push(result);
    }
    return out;
}
/** Conservative text-only parser: standard-font, unencrypted PDF content streams.
 * It deliberately does not claim OCR, font-CMap support, table recognition or universal PDF coverage.
 * Complex/scanned files remain usable as evidence and require manual field review.
 */
export function basicPdfText(bytes) {
    const raw = bytes.toString('latin1');
    if (/\/Encrypt\b|\/ToUnicode\b|\/Subtype\s*\/Type0\b/.test(raw))
        return '';
    const pieces = [];
    let matches = 0;
    let expanded = 0;
    const pattern = /\bstream\r?\n/g;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
        if (++matches > 100)
            break;
        const end = raw.indexOf('endstream', pattern.lastIndex);
        if (end === -1)
            break;
        const start = pattern.lastIndex;
        pattern.lastIndex = end + 9;
        const header = raw.slice(Math.max(0, match.index - 2048), match.index);
        const dictionary = header.slice(header.lastIndexOf('<<'));
        if (/\/Subtype\s*\/Image/.test(dictionary))
            continue;
        let stream = Buffer.from(raw.slice(start, end).replace(/\r?\n$/, ''), 'latin1');
        try {
            if (/\/ASCII85Decode/.test(dictionary))
                stream = ascii85(stream);
            if (/\/FlateDecode/.test(dictionary))
                stream = inflateSync(stream, { maxOutputLength: 1024 * 1024 });
            if (/\/Filter/.test(dictionary) && !/\/FlateDecode|\/ASCII85Decode/.test(dictionary))
                continue;
            expanded += stream.length;
            if (expanded > 2 * 1024 * 1024)
                break;
            const content = stream.toString('latin1');
            for (const block of content.matchAll(/\bBT\b([\s\S]*?)\bET\b/g))
                pieces.push(...literalStrings(block[1]));
        }
        catch { /* Unsupported stream: never fabricate extracted fields. */ }
    }
    return pieces.join('\n').slice(0, 100000);
}
export function parseInvoiceText(raw) {
    const source = raw.replace(/\r/g, '').slice(0, 100000);
    const fields = {};
    const warnings = [];
    const take = (regex) => source.match(regex)?.[1]?.trim();
    const vendor = take(/(?:^|\n)\s*(?:vendor|supplier|billed by)\s*:\s*([^\n]{2,150})/i);
    const invoiceNumber = take(/(?:invoice|bill)\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9/_.-]{1,79})/i);
    const invoiceDate = take(/(?:invoice date|bill date|date)\s*:\s*(\d{4}-\d{2}-\d{2})/i);
    if (vendor)
        fields.vendor = vendor;
    if (invoiceNumber)
        fields.invoiceNumber = invoiceNumber;
    if (invoiceDate && Number.isFinite(Date.parse(invoiceDate)) && new Date(invoiceDate).toISOString().slice(0, 10) === invoiceDate)
        fields.activityDate = invoiceDate;
    const quantityMatches = [...source.matchAll(/(?:units consumed|energy consumed|consumption|fuel quantity|quantity)\s*[:=\-]?\s*([\d,]+(?:\.\d{1,4})?)\s*(kwh|mwh|litres?|liters?|ltr|kg|m3|m\u00b3)\b/gi)];
    if (quantityMatches.length === 1) {
        const match = quantityMatches[0];
        let quantity = Number(match[1].replaceAll(',', ''));
        let unit = match[2].toLowerCase();
        if (unit === 'mwh') {
            quantity *= 1000;
            unit = 'kWh';
            warnings.push('MWh was converted to kWh. Confirm the conversion.');
        }
        else if (unit === 'kwh')
            unit = 'kWh';
        else if (/lit|ltr/.test(unit))
            unit = 'litre';
        else if (unit === 'm\u00b3')
            unit = 'm3';
        if (Number.isFinite(quantity) && quantity > 0 && quantity <= 1e9) {
            fields.quantity = quantity;
            fields.unit = unit;
        }
        if (unit === 'kWh')
            fields.category = 'PURCHASED_ELECTRICITY';
        else if (unit === 'kg' && /\bLPG\b/i.test(source))
            fields.category = 'LPG';
        else if (unit === 'm3' && /natural gas/i.test(source))
            fields.category = 'NATURAL_GAS';
        else if (unit === 'litre') {
            const diesel = /\bdiesel\b/i.test(source);
            const petrol = /\bpetrol\b/i.test(source);
            if (diesel !== petrol)
                fields.category = diesel ? 'DIESEL' : 'PETROL';
        }
    }
    else if (quantityMatches.length > 1)
        warnings.push('Multiple consumption lines found. No quantity was selected; manually confirm a single activity.');
    const amountMatches = [...source.matchAll(/(?:total amount|amount payable|grand total|bill amount)\s*[:=]?\s*(?:INR|Rs\.?|\u20b9)?\s*([\d,]+(?:\.\d{1,2})?)/gi)];
    if (amountMatches.length === 1) {
        const amount = Number(amountMatches[0][1].replaceAll(',', ''));
        if (Number.isFinite(amount) && amount >= 0)
            fields.amountInr = amount;
    }
    if (!fields.quantity)
        warnings.push('Consumption quantity was not identified. Money is NEVER substituted for consumption.');
    if (!fields.category)
        warnings.push('Select and verify the activity category.');
    warnings.push('Extracted fields are suggestions. A person must check the original invoice before creating a draft.');
    return { fields, warnings };
}
export function extractInvoice(bytes, mimeType) {
    const raw = mimeType === 'text/plain' ? bytes.toString('utf8') : mimeType === 'application/pdf' ? basicPdfText(bytes) : '';
    const parsed = parseInvoiceText(raw);
    return { method: raw ? (mimeType === 'application/pdf' ? 'BASIC_PDF_TEXT' : 'TEXT_INVOICE') : 'MANUAL_REVIEW', ...parsed,
        textPreview: raw.slice(0, 12000), fieldsDetected: Object.keys(parsed.fields), needsHumanReview: true, ocrAvailable: false,
        ...(raw ? {} : { warnings: ['This image, scan or PDF layout needs manual entry. The original file is preserved as evidence.', ...parsed.warnings] }) };
}

````


## scale-api/src/jobs.mjs

````javascript
import { id, uuid, hash, fail, role, text } from './core.mjs';
import { tenantTx, audit, enqueue } from './db.mjs';
import { openPeriod } from './activities.mjs';
export async function claimJob(pool, leaseSeconds = 180) {
    await pool.query("UPDATE cs.jobs SET status='DEAD',lease_token=NULL,lease_until=NULL,last_error='LEASE_EXHAUSTED',updated_at=now() WHERE status='RUNNING' AND lease_until<now() AND attempts>=max_attempts");
    return (await pool.query(`WITH candidate AS (
    SELECT id FROM cs.jobs WHERE attempts<max_attempts AND ((status='QUEUED' AND available_at<=now()) OR (status='RUNNING' AND lease_until<now()))
    ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE cs.jobs j SET status='RUNNING',attempts=j.attempts+1,lease_token=$1,lease_until=now()+$2*interval '1 second',updated_at=now()
  FROM candidate WHERE j.id=candidate.id RETURNING j.*`, [id(), leaseSeconds])).rows[0] || null;
}
export async function ownedJob(c, job) {
    const r = (await c.query("SELECT * FROM cs.jobs WHERE id=$1 AND tenant_id=$2 AND status='RUNNING' AND lease_token=$3 AND lease_until>now() FOR UPDATE", [job.id, job.tenant_id, job.lease_token])).rows[0];
    if (!r)
        fail(409, 'LEASE_LOST', 'Worker lease is no longer valid.');
    return r;
}
export async function done(c, job) { await c.query("UPDATE cs.jobs SET status='DONE',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND lease_token=$3", [job.id, job.tenant_id, job.lease_token]); }
export async function failJob(pool, job, error) {
    const code = error?.code === 'PERIOD_LOCKED' ? 'PERIOD_LOCKED' : error?.message === 'SCAN_TIMEOUT' ? 'SCAN_TIMEOUT' : error?.code === 'LEASE_LOST' ? 'LEASE_LOST' : 'PROCESSING_FAILED';
    const delay = Math.min(900, 2 ** job.attempts * 5) + Math.floor(Math.random() * 5);
    await pool.query(`UPDATE cs.jobs SET status=CASE WHEN attempts>=max_attempts THEN 'DEAD' ELSE 'QUEUED' END,available_at=now()+$4*interval '1 second',lease_token=NULL,lease_until=NULL,last_error=$5,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND lease_token=$3`, [job.id, job.tenant_id, job.lease_token, delay, code]);
}
export async function processCalculation(pool, job) {
    return tenantTx(pool, job.tenant_id, async (c) => {
        await ownedJob(c, job);
        const tenant = (await c.query("SELECT status FROM cs.tenants WHERE id=$1", [job.tenant_id])).rows[0];
        if (tenant?.status !== 'ACTIVE')
            fail(409, 'TENANT_SUSPENDED', 'Tenant is suspended.');
        const seen = (await c.query('SELECT period_id FROM cs.activities WHERE tenant_id=$1 AND id=$2', [job.tenant_id, job.entity_id])).rows[0];
        if (!seen)
            fail(404, 'NOT_FOUND', 'Activity not found.');
        await openPeriod(c, job.tenant_id, seen.period_id);
        const a = (await c.query('SELECT * FROM cs.activities WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [job.tenant_id, job.entity_id])).rows[0];
        if (a.status === 'CALCULATED') {
            await done(c, job);
            return;
        }
        if (a.status !== 'VERIFIED' || !a.verified_by || a.verified_by === a.created_by)
            fail(409, 'NOT_VERIFIED', 'Activity must be independently verified.');
        const f = (await c.query("SELECT * FROM cs.factors WHERE tenant_id=$1 AND id=$2 AND status='APPROVED'", [job.tenant_id, a.factor_id])).rows[0];
        if (!f || f.category !== a.category || f.unit !== a.unit || f.scope !== a.scope || a.activity_date < f.valid_from || a.activity_date > f.valid_to)
            fail(422, 'INVALID_FACTOR', 'Approved factor no longer matches.');
        // Insert, aggregate update, activity state and job acknowledgement are one transaction.
        const cal = (await c.query(`INSERT INTO cs.calculations(id,tenant_id,activity_id,factor_id,quantity,factor_value,kg_co2e,factor_version,factor_source,provenance)
      VALUES($1,$2,$3,$4,$5,$6,round($5::numeric*$6::numeric,6),$7,$8,$9) ON CONFLICT(tenant_id,activity_id) DO NOTHING RETURNING *`, [id(), job.tenant_id, a.id, f.id, a.quantity, f.value, f.version_label, f.source, JSON.stringify({ sourceUrl: f.source_url, region: f.region, methodology: f.methodology, unit: f.unit, validFrom: f.valid_from, validTo: f.valid_to, approvedBy: f.approved_by, verifiedBy: a.verified_by })])).rows[0];
        if (cal)
            await c.query(`INSERT INTO cs.monthly_totals(tenant_id,period_id,campus_id,month,scope,category,kg_co2e,record_count,evidence_count) VALUES($1,$2,$3,date_trunc('month',$4::date)::date,$5,$6,$7,1,$8)
      ON CONFLICT(tenant_id,period_id,campus_id,month,scope,category) DO UPDATE SET kg_co2e=cs.monthly_totals.kg_co2e+EXCLUDED.kg_co2e,record_count=cs.monthly_totals.record_count+1,evidence_count=cs.monthly_totals.evidence_count+EXCLUDED.evidence_count`, [job.tenant_id, a.period_id, a.campus_id, a.activity_date, a.scope, a.category, cal.kg_co2e, a.document_id ? 1 : 0]);
        await c.query("UPDATE cs.activities SET status='CALCULATED',version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2", [job.tenant_id, a.id]);
        await audit(c, { tenant_id: job.tenant_id }, 'ACTIVITY_CALCULATED', a.id, { jobId: job.id, factorId: f.id, kgCO2e: cal?.kg_co2e || null });
        await done(c, job);
    });
}
export async function processInvoice(pool, storage, scanner, extractor, job) {
    const d = await tenantTx(pool, job.tenant_id, async (c) => (await c.query('SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2', [job.tenant_id, job.entity_id])).rows[0]);
    if (!d)
        fail(404, 'NOT_FOUND', 'Invoice not found.');
    if (d.status !== 'QUEUED')
        return tenantTx(pool, job.tenant_id, async (c) => { await ownedJob(c, job); if (['LINKED', 'REVIEW_REQUIRED', 'REJECTED'].includes(d.status))
            await done(c, job);
        else
            fail(409, 'INVALID_STATE', 'Invoice not queued.'); });
    const bytes = await storage.get(d.object_key, d.object_version, Number(d.file_size));
    if (hash(bytes) !== d.sha256 || bytes.length !== Number(d.file_size))
        fail(409, 'EVIDENCE_INTEGRITY', 'Invoice digest mismatch.');
    const scan = await scanner(bytes);
    if (!['CLEAN', 'INFECTED'].includes(scan.status))
        throw Error('Unexpected scanner result');
    const extraction = scan.status === 'CLEAN' ? await extractor(bytes, d.mime_type) : null;
    return tenantTx(pool, job.tenant_id, async (c) => {
        await ownedJob(c, job);
        const changed = await c.query("UPDATE cs.documents SET status=$3,scan_result=$4,scan_engine=$5,extraction=$6,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='QUEUED' AND object_version=$7", [job.tenant_id, d.id, scan.status === 'CLEAN' ? 'REVIEW_REQUIRED' : 'REJECTED', scan.status, scan.engine, extraction ? JSON.stringify(extraction) : null, d.object_version]);
        if (changed.rowCount)
            await audit(c, { tenant_id: job.tenant_id }, 'INVOICE_SCANNED', d.id, { result: scan.status, jobId: job.id });
        await done(c, job);
    });
}
export async function retryJob(pool, user, jobId, body) {
    role(user, ['ADMIN']);
    uuid(jobId);
    const reason = text(body.reason, 'reason', 500);
    if (reason.length < 10)
        fail(422, 'REASON_REQUIRED', 'Explain why this job should be retried.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        const row = (await c.query("UPDATE cs.jobs SET status='QUEUED',attempts=0,lease_token=NULL,lease_until=NULL,available_at=now(),last_error=NULL,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status='DEAD' RETURNING *", [user.tenant_id, jobId])).rows[0];
        if (!row)
            fail(409, 'NOT_RETRYABLE', 'Job is not in the dead-letter queue.');
        await audit(c, user, 'JOB_RETRIED', jobId, { reason });
        return row;
    });
}
export async function reconcileUpload(pool, storage, tenantId, documentId) {
    const d = await tenantTx(pool, tenantId, async (c) => (await c.query("SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 AND status='UPLOADING' AND upload_deadline<now()", [tenantId, documentId])).rows[0]);
    if (!d)
        return;
    let stored = null;
    try {
        stored = await storage.head(d.object_key);
    }
    catch (e) {
        if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== 'NotFound' && e?.name !== 'NoSuchKey')
            throw e;
    }
    if (stored && (!stored.versionId || stored.versionId === 'null' || stored.sha256 !== d.sha256 || Number(stored.size) !== Number(d.file_size)))
        throw Error('RECONCILIATION_INTEGRITY_FAILURE');
    await tenantTx(pool, tenantId, async (c) => {
        const current = (await c.query("SELECT * FROM cs.documents WHERE tenant_id=$1 AND id=$2 AND status='UPLOADING' AND object_key=$3 FOR UPDATE", [tenantId, documentId, d.object_key])).rows[0];
        if (!current)
            return;
        if (stored) {
            await c.query("UPDATE cs.documents SET status='QUEUED',object_version=$3,version=version+1 WHERE tenant_id=$1 AND id=$2", [tenantId, documentId, stored.versionId]);
            await enqueue(c, tenantId, 'SCAN_INVOICE', documentId);
        }
        else {
            if (current.quota_reserved)
                await c.query('UPDATE cs.tenants SET storage_used_bytes=storage_used_bytes-$2 WHERE id=$1', [tenantId, Number(d.file_size)]);
            await c.query("UPDATE cs.documents SET status='UPLOAD_FAILED',quota_reserved=false,version=version+1 WHERE tenant_id=$1 AND id=$2", [tenantId, documentId]);
        }
        await audit(c, { tenant_id: tenantId }, stored ? 'UPLOAD_RECOVERED' : 'UPLOAD_FAILED', documentId);
    });
}

````


## scale-api/src/main.mjs

````javascript
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

````


## scale-api/src/management.mjs

````javascript
import { id, text, uuid, day, decimal, role, fail, CATEGORIES, passwordHash, version, pagination, page } from './core.mjs';
import { tenantTx, audit, idempotent } from './db.mjs';
export async function metadata(pool, user) {
    return tenantTx(pool, user.tenant_id, async (c) => {
        const tenant = (await c.query('SELECT id,name,status,storage_quota_bytes,storage_used_bytes FROM cs.tenants WHERE id=$1', [user.tenant_id])).rows[0];
        const result = { tenant, categories: CATEGORIES, limits: { metadataListLimit: 500, uploadBytes: 10485760 }, ocrAvailable: false };
        for (const t of ['campuses', 'buildings', 'periods', 'factors'])
            result[t] = (await c.query(`SELECT * FROM cs.${t} WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500`, [user.tenant_id])).rows;
        return result;
    });
}
export async function listResource(pool, user, kind, query) {
    if (!['campuses', 'buildings', 'periods', 'factors', 'users', 'documents', 'jobs'].includes(kind))
        fail(404, 'NOT_FOUND', 'Resource not found.');
    if (kind === 'users')
        role(user, ['ADMIN']);
    const { limit, cursor } = pagination(query);
    const columns = kind === 'users' ? 'id,tenant_id,name,email,role,active,created_at' : kind === 'documents' ? 'id,original_name,mime_type,file_size,sha256,status,scan_result,scan_engine,extraction,reviewed,version,created_at' : kind === 'jobs' ? 'id,kind,entity_id,status,attempts,max_attempts,available_at,last_error,created_at' : '*';
    return tenantTx(pool, user.tenant_id, async (c) => page((await c.query(`SELECT ${columns} FROM cs.${kind} WHERE tenant_id=$1 ${cursor ? 'AND (created_at,id)<($3::timestamptz,$4::uuid)' : ''} ORDER BY created_at DESC,id DESC LIMIT $2`, [user.tenant_id, limit + 1, ...(cursor || [])])).rows, limit));
}
export async function createResource(pool, user, kind, body, key) {
    role(user, ['ADMIN']);
    if (!['campuses', 'buildings', 'periods', 'users', 'factors'].includes(kind))
        fail(404, 'NOT_FOUND', 'Resource not found.');
    const name = kind === 'factors' ? null : text(body.name, 'name', 160);
    // Expensive password hashing is outside the database transaction.
    const pass = kind === 'users' ? await passwordHash(body.password) : null;
    return tenantTx(pool, user.tenant_id, c => idempotent(c, user, 'create-' + kind, key, body, async () => {
        const rid = id();
        let row;
        if (kind === 'campuses')
            row = (await c.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4) RETURNING *', [rid, user.tenant_id, name, text(body.code, 'code', 30)])).rows[0];
        if (kind === 'buildings')
            row = (await c.query('INSERT INTO cs.buildings(id,tenant_id,campus_id,name) VALUES($1,$2,$3,$4) RETURNING *', [rid, user.tenant_id, uuid(body.campusId), name])).rows[0];
        if (kind === 'periods') {
            const start = day(body.startDate), end = day(body.endDate);
            if (start > end)
                fail(422, 'DATE_RANGE', 'End date must not be before start date.');
            row = (await c.query('INSERT INTO cs.periods(id,tenant_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING *', [rid, user.tenant_id, name, start, end])).rows[0];
        }
        if (kind === 'users') {
            if (!['ADMIN', 'ENTRY', 'REVIEWER', 'LEADERSHIP'].includes(body.role))
                fail(422, 'INVALID_ROLE', 'Select a supported role.');
            const email = text(body.email, 'email', 254).toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
                fail(422, 'INVALID_EMAIL', 'Enter a valid email.');
            row = (await c.query('INSERT INTO cs.users(id,tenant_id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,tenant_id,name,email,role,active,created_at', [rid, user.tenant_id, name, email, body.role, pass])).rows[0];
        }
        if (kind === 'factors') {
            const category = text(body.category, 'category', 60), spec = CATEGORIES[category];
            if (!spec || body.unit !== spec[1])
                fail(422, 'UNIT_MISMATCH', 'Use a supported canonical unit.');
            let sourceUrl;
            try {
                sourceUrl = new URL(body.sourceUrl);
                if (sourceUrl.protocol !== 'https:')
                    throw Error();
            }
            catch {
                fail(422, 'SOURCE_REQUIRED', 'Provide the HTTPS source URL of your approved methodology.');
            }
            const from = day(body.validFrom), to = day(body.validTo);
            if (from > to)
                fail(422, 'DATE_RANGE', 'Invalid factor validity.');
            row = (await c.query(`INSERT INTO cs.factors(id,tenant_id,category,scope,unit,value,version_label,source,source_url,region,methodology,valid_from,valid_to,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`, [rid, user.tenant_id, category, spec[0], spec[1], decimal(body.value, 'factor', 9), text(body.versionLabel, 'versionLabel', 80), text(body.source, 'source', 500), sourceUrl.href, text(body.region, 'region', 100), text(body.methodology, 'methodology', 1000), from, to, user.id])).rows[0];
        }
        await audit(c, user, 'CREATED_' + kind.toUpperCase(), rid, kind === 'users' ? { role: row.role } : { name: row.name || row.version_label });
        return row;
    }));
}
export async function approveFactor(pool, user, factorId) {
    role(user, ['ADMIN', 'REVIEWER']);
    uuid(factorId);
    return tenantTx(pool, user.tenant_id, async (c) => {
        const old = (await c.query('SELECT * FROM cs.factors WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, factorId])).rows[0];
        if (!old)
            fail(404, 'NOT_FOUND', 'Factor not found.');
        if (old.created_by === user.id)
            fail(403, 'SELF_APPROVAL', 'Another person must approve the factor.');
        if (old.status === 'APPROVED')
            return old;
        const row = (await c.query("UPDATE cs.factors SET status='APPROVED',approved_by=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *", [user.tenant_id, factorId, user.id])).rows[0];
        await audit(c, user, 'FACTOR_APPROVED', factorId, { version: row.version_label, source: row.source });
        return row;
    });
}
export async function setPeriod(pool, user, periodId, body, lock) {
    role(user, ['ADMIN']);
    uuid(periodId);
    const reason = text(body.reason, 'reason', 500);
    if (reason.length < 10)
        fail(422, 'REASON_REQUIRED', 'Explain the lock or reopening in at least 10 characters.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        const old = (await c.query('SELECT * FROM cs.periods WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, periodId])).rows[0];
        if (!old)
            fail(404, 'NOT_FOUND', 'Period not found.');
        version(old, body.version);
        if (lock) {
            const pending = (await c.query("SELECT 1 FROM cs.activities WHERE tenant_id=$1 AND period_id=$2 AND status NOT IN ('CALCULATED','REJECTED') LIMIT 1", [user.tenant_id, periodId])).rows;
            if (pending.length)
                fail(409, 'PENDING_ACTIVITIES', 'Resolve pending activities before locking the period.');
        }
        const row = (await c.query('UPDATE cs.periods SET status=$3,version=version+1 WHERE tenant_id=$1 AND id=$2 RETURNING *', [user.tenant_id, periodId, lock ? 'LOCKED' : 'OPEN'])).rows[0];
        await audit(c, user, lock ? 'PERIOD_LOCKED' : 'PERIOD_REOPENED', periodId, { reason });
        return row;
    });
}
export async function updateUser(pool, user, targetId, body) {
    role(user, ['ADMIN']);
    uuid(targetId);
    if (!['ADMIN', 'ENTRY', 'REVIEWER', 'LEADERSHIP'].includes(body.role) || typeof body.active !== 'boolean')
        fail(422, 'INVALID_USER', 'role and active are required.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        await c.query('SELECT id FROM cs.tenants WHERE id=$1 FOR UPDATE', [user.tenant_id]);
        const old = (await c.query('SELECT id,role,active FROM cs.users WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [user.tenant_id, targetId])).rows[0];
        if (!old)
            fail(404, 'NOT_FOUND', 'User not found.');
        if (old.role === 'ADMIN' && old.active && (body.role !== 'ADMIN' || !body.active)) {
            const n = (await c.query("SELECT count(*) AS n FROM cs.users WHERE tenant_id=$1 AND role='ADMIN' AND active", [user.tenant_id])).rows[0];
            if (Number(n.n) <= 1)
                fail(409, 'LAST_ADMIN', 'At least one active administrator is required.');
        }
        await c.query('UPDATE cs.users SET role=$3,active=$4 WHERE tenant_id=$1 AND id=$2', [user.tenant_id, targetId, body.role, body.active]);
        await c.query('DELETE FROM cs.sessions WHERE tenant_id=$1 AND user_id=$2', [user.tenant_id, targetId]);
        await audit(c, user, 'USER_ACCESS_CHANGED', targetId, { before: old, after: { role: body.role, active: body.active } });
        return { id: targetId, role: body.role, active: body.active, sessionsRevoked: true };
    });
}

````


## scale-api/src/metrics.mjs

````javascript
export class Metrics {
    constructor() { this.requests = new Map(); this.count = 0; this.durationSum = 0; this.active = 0; this.start = Date.now(); this.buckets = new Map([0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60].map(x => [x, 0])); }
    observe(status, seconds) { this.requests.set(String(status), 1 + (this.requests.get(String(status)) || 0)); this.count++; this.durationSum += seconds; for (const [b, n] of this.buckets)
        if (seconds <= b)
            this.buckets.set(b, n + 1); }
    render() {
        const out = ['# TYPE carbonsynq_http_requests_total counter'];
        for (const [status, count] of this.requests)
            out.push(`carbonsynq_http_requests_total{status="${status}"} ${count}`);
        out.push('# TYPE carbonsynq_http_duration_seconds histogram');
        for (const [b, n] of this.buckets)
            out.push(`carbonsynq_http_duration_seconds_bucket{le="${b}"} ${n}`);
        out.push(`carbonsynq_http_duration_seconds_bucket{le="+Inf"} ${this.count}`, `carbonsynq_http_duration_seconds_sum ${this.durationSum}`, `carbonsynq_http_duration_seconds_count ${this.count}`, '# TYPE carbonsynq_http_active gauge', `carbonsynq_http_active ${this.active}`, '# TYPE carbonsynq_process_uptime_seconds gauge', `carbonsynq_process_uptime_seconds ${(Date.now() - this.start) / 1000}`);
        return out.join('\n') + '\n';
    }
}

````


## scale-api/src/reporting.mjs

````javascript
import { uuid, fail, text } from './core.mjs';
import { tenantTx } from './db.mjs';
export async function dashboard(pool, user, query = {}) {
    const periodId = query.periodId ? uuid(query.periodId) : null;
    return tenantTx(pool, user.tenant_id, async (c) => {
        const p = [user.tenant_id, periodId];
        const totals = (await c.query(`SELECT coalesce(sum(kg_co2e),0)::text AS kg_co2e,round(coalesce(sum(kg_co2e),0)/1000,6)::text AS tonnes_co2e,
      coalesce(sum(record_count),0)::text AS calculated_records,coalesce(sum(evidence_count),0)::text AS invoice_backed_records FROM cs.monthly_totals WHERE tenant_id=$1 AND ($2::uuid IS NULL OR period_id=$2)`, p)).rows[0];
        const monthly = (await c.query(`SELECT month::text,scope,sum(kg_co2e)::text AS kg_co2e FROM cs.monthly_totals WHERE tenant_id=$1 AND ($2::uuid IS NULL OR period_id=$2) GROUP BY month,scope ORDER BY month DESC,scope LIMIT 240`, p)).rows;
        const campuses = (await c.query(`SELECT m.campus_id,c.name,sum(m.kg_co2e)::text AS kg_co2e FROM cs.monthly_totals m JOIN cs.campuses c ON c.id=m.campus_id AND c.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND ($2::uuid IS NULL OR m.period_id=$2) GROUP BY m.campus_id,c.name ORDER BY sum(m.kg_co2e) DESC LIMIT 100`, p)).rows;
        const pipeline = (await c.query('SELECT status,count(*)::text AS count FROM cs.activities WHERE tenant_id=$1 AND ($2::uuid IS NULL OR period_id=$2) GROUP BY status', p)).rows;
        const jobs = (await c.query('SELECT status,count(*)::text AS count FROM cs.jobs WHERE tenant_id=$1 GROUP BY status', [user.tenant_id])).rows;
        return { totals, monthly, campuses, pipeline, jobs, accountingBoundary: 'Scope 1 and location-based Scope 2 only. Factors are selected and approved by your organization.', evidenceDefinition: 'Count of calculated records linked to a scanned invoice; not independent assurance.', displayLimits: { monthlyRows: 240, campuses: 100 } };
    });
}
export async function auditList(pool, user, query = {}) {
    const limit = Number(query.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(422, 'INVALID_LIMIT', 'limit must be 1 to 100.');
    const before = query.before ? text(query.before, 'before', 20) : null;
    if (before && !/^[1-9][0-9]{0,18}$/.test(before))
        fail(422, 'INVALID_CURSOR', 'before must be a positive audit ID.');
    return tenantTx(pool, user.tenant_id, async (c) => {
        const rows = (await c.query('SELECT * FROM cs.audit_events WHERE tenant_id=$1 AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT $2', [user.tenant_id, limit + 1, before])).rows;
        return { items: rows.slice(0, limit), nextBefore: rows.length > limit ? rows[limit - 1].id : null };
    });
}
export async function ledger(pool, user, query = {}) {
    const limit = Number(query.limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        fail(422, 'INVALID_LIMIT', 'limit must be 1 to 100.');
    const after = query.after ? uuid(query.after) : null, periodId = query.periodId ? uuid(query.periodId) : null;
    return tenantTx(pool, user.tenant_id, async (c) => {
        const rows = (await c.query(`SELECT a.id,a.period_id,a.campus_id,a.building_id,a.activity_date,a.category,a.scope,a.quantity,a.unit,a.status,a.document_id,
      cal.kg_co2e,cal.factor_value,cal.factor_version,cal.factor_source,cal.provenance,d.sha256 AS evidence_sha256 FROM cs.activities a
      LEFT JOIN cs.calculations cal ON cal.tenant_id=a.tenant_id AND cal.activity_id=a.id LEFT JOIN cs.documents d ON d.tenant_id=a.tenant_id AND d.id=a.document_id
      WHERE a.tenant_id=$1 AND ($3::uuid IS NULL OR a.id>$3) AND ($4::uuid IS NULL OR a.period_id=$4) ORDER BY a.id LIMIT $2`, [user.tenant_id, limit + 1, after, periodId])).rows;
        return { items: rows.slice(0, limit), nextAfter: rows.length > limit ? rows[limit - 1].id : null, consistency: 'Live pages, not a point-in-time snapshot. Lock the period before a final export.' };
    });
}

````


## scale-api/src/scanner.mjs

````javascript
import net from 'node:net';
import { Worker } from 'node:worker_threads';
// ClamD is unauthenticated. Keep this connection on a private network only.
export function scanWithClamd(bytes, { clamHost, clamPort, scanTimeoutMs = 45000 }) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: clamHost, port: clamPort });
        let response = '';
        let settled = false;
        const finish = (error, value) => { if (settled)
            return; settled = true; clearTimeout(wall); socket.destroy(); error ? reject(error) : resolve(value); };
        const wall = setTimeout(() => finish(Error('SCAN_TIMEOUT')), scanTimeoutMs);
        socket.setTimeout(scanTimeoutMs, () => finish(Error('SCAN_TIMEOUT')));
        socket.on('error', e => finish(e));
        socket.on('close', () => { if (!settled)
            finish(Error('SCAN_CONNECTION_CLOSED')); });
        socket.on('connect', async () => {
            try {
                const write = buffer => new Promise((res, rej) => socket.write(buffer, e => e ? rej(e) : res()));
                await write(Buffer.from('zINSTREAM\0'));
                for (let i = 0; i < bytes.length; i += 65536) {
                    const chunk = bytes.subarray(i, i + 65536), n = Buffer.alloc(4);
                    n.writeUInt32BE(chunk.length);
                    await write(n);
                    await write(chunk);
                }
                await write(Buffer.alloc(4));
            }
            catch (e) {
                finish(e);
            }
        });
        socket.on('data', chunk => {
            response += chunk.toString('utf8');
            if (response.length > 4096)
                return finish(Error('SCAN_RESPONSE_TOO_LARGE'));
            if (!response.includes('\0') && !response.includes('\n'))
                return;
            const result = response.replace(/[\0\r\n]/g, '').trim();
            if (result === 'stream: OK')
                finish(null, { status: 'CLEAN', engine: 'ClamAV INSTREAM' });
            else if (/^stream: .+ FOUND$/.test(result))
                finish(null, { status: 'INFECTED', engine: 'ClamAV INSTREAM' });
            else
                finish(Error('SCAN_UNAVAILABLE_OR_LIMIT_EXCEEDED'));
        });
    });
}
export function extractBounded(bytes, mime, timeoutMs = 8000) {
    return new Promise(resolve => {
        const thread = new Worker(new URL('./extract-thread.mjs', import.meta.url), { workerData: { bytes, mime }, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 } });
        let settled = false;
        const finish = result => { if (settled)
            return; settled = true; clearTimeout(timer); thread.terminate(); resolve(result); };
        const fallback = () => finish({ method: 'MANUAL_REVIEW', fields: {}, warnings: ['Automatic text extraction was unavailable. Enter and review actual consumption manually.'], needsHumanReview: true, ocrAvailable: false });
        const timer = setTimeout(fallback, timeoutMs);
        thread.on('message', finish);
        thread.on('error', fallback);
        thread.on('exit', () => { if (!settled)
            fallback(); });
    });
}

````


## scale-api/src/services.mjs

````javascript
import * as auth from './auth.mjs';
import * as management from './management.mjs';
import * as activities from './activities.mjs';
import * as documents from './documents.mjs';
import * as reports from './reporting.mjs';
import { retryJob } from './jobs.mjs';
import { role, WRITERS } from './core.mjs';
export function services(pool, storage, config) {
    const api = {};
    let readinessPromise = null, readinessAt = 0;
    for (const module of [management, activities, reports])
        for (const [name, fn] of Object.entries(module))
            api[name] = (...args) => fn(pool, ...args);
    Object.assign(api, {
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

````


## scale-api/src/storage.mjs

````javascript
import { hash, fail } from './core.mjs';
import path from 'node:path';
export function validateUpload(filename, mime, bytes, max = 10485760) {
    if (!Buffer.isBuffer(bytes) || !bytes.length)
        fail(422, 'EMPTY_FILE', 'Upload a non-empty file.');
    if (bytes.length > max)
        fail(413, 'FILE_TOO_LARGE', 'Invoice exceeds the upload size limit.');
    if (typeof filename !== 'string')
        fail(422, 'FILENAME_REQUIRED', 'Send the original filename in X-Filename.');
    const name = path.basename(filename.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 180), ext = path.extname(name).toLowerCase();
    let actual;
    if (ext === '.pdf' && bytes.subarray(0, 5).toString() === '%PDF-')
        actual = 'application/pdf';
    else if (ext === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        actual = 'image/png';
    else if (['.jpg', '.jpeg'].includes(ext) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
        actual = 'image/jpeg';
    else if (ext === '.txt' && !bytes.includes(0) && !bytes.toString('utf8').includes('\ufffd'))
        actual = 'text/plain';
    else
        fail(415, 'UNSUPPORTED_FILE', 'Extension and signature must match PDF, PNG, JPEG or UTF-8 TXT.');
    if (mime?.split(';')[0] !== actual)
        fail(415, 'MIME_MISMATCH', 'Content-Type must match the actual uploaded file.');
    return { name, mime: actual, size: bytes.length, sha256: hash(bytes) };
}
export async function createStorage(config) {
    const sdk = await import('@aws-sdk/client-s3');
    const client = new sdk.S3Client({ region: config.region, endpoint: config.endpoint, forcePathStyle: config.forcePathStyle, maxAttempts: 2 });
    const send = (cmd, ms = 30000) => client.send(cmd, { abortSignal: AbortSignal.timeout(ms) });
    return {
        async check() {
            const r = await send(new sdk.GetBucketVersioningCommand({ Bucket: config.bucket }), 5000);
            if (r.Status !== 'Enabled')
                throw Error('Enable S3 bucket versioning before starting the API or worker.');
            if (config.production) {
                const p = await send(new sdk.GetPublicAccessBlockCommand({ Bucket: config.bucket }), 5000);
                if (!['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].every(k => p.PublicAccessBlockConfiguration?.[k] === true))
                    throw Error('All four S3 public-access blocks must be enabled.');
                await send(new sdk.GetBucketEncryptionCommand({ Bucket: config.bucket }), 5000);
            }
            return true;
        },
        async put(key, bytes, mime) { const r = await send(new sdk.PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: mime, ChecksumSHA256: Buffer.from(hash(bytes), 'hex').toString('base64'), Metadata: { sha256: hash(bytes) } })); if (!r.VersionId || r.VersionId === 'null')
            throw Error('Object version ID missing. Bucket versioning is required.'); return { versionId: r.VersionId }; },
        async get(key, versionId, maxBytes = config.maxUploadBytes) {
            if (!versionId || versionId === 'null')
                throw Error('An immutable object version is required.');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            let body;
            try {
                const r = await client.send(new sdk.GetObjectCommand({ Bucket: config.bucket, Key: key, VersionId: versionId }), { abortSignal: controller.signal });
                body = r.Body;
                if (Number(r.ContentLength) > maxBytes)
                    throw Error('Stored object exceeds the size limit.');
                const chunks = [];
                let size = 0;
                for await (const chunk of body) {
                    size += chunk.length;
                    if (size > maxBytes)
                        throw Error('Stored object exceeds the size limit.');
                    chunks.push(Buffer.from(chunk));
                }
                return Buffer.concat(chunks);
            }
            finally {
                clearTimeout(timer);
                body?.destroy?.();
            }
        },
        async head(key) { const r = await send(new sdk.HeadObjectCommand({ Bucket: config.bucket, Key: key }), 5000); return { versionId: r.VersionId, size: r.ContentLength, sha256: r.Metadata?.sha256 }; },
        close() { client.destroy(); }
    };
}

````


## scale-api/src/worker-main.mjs

````javascript
import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config.mjs';
import { id } from './core.mjs';
import { createPool, assertRuntimeRole, tenantTx } from './db.mjs';
import { createStorage } from './storage.mjs';
import { scanWithClamd, extractBounded } from './scanner.mjs';
import { claimJob, failJob, processCalculation, processInvoice, reconcileUpload, ownedJob, done } from './jobs.mjs';
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
                await processInvoice(pool, storage, bytes => scanWithClamd(bytes, cfg), extractBounded, job);
            else if (job.kind === 'RECONCILE_UPLOAD') {
                // Reconciliation is idempotent; acknowledge only with the current fencing token.
                await tenantTx(pool, job.tenant_id, c => ownedJob(c, job));
                await reconcileUpload(pool, storage, job.tenant_id, job.entity_id);
                await tenantTx(pool, job.tenant_id, async (c) => { await ownedJob(c, job); await done(c, job); });
            }
            console.log(JSON.stringify({ event: 'job_done', jobId: job.id, kind: job.kind }));
        }
        catch (error) {
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

````


## scale-api/tests/adapters.test.mjs

````javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { tenantTx, idempotent, assertRuntimeRole, enqueue } from '../src/db.mjs';
import { claimJob, ownedJob } from '../src/jobs.mjs';
import { scanWithClamd } from '../src/scanner.mjs';
import { readFile } from 'node:fs/promises';
const tenant = '11111111-1111-4111-8111-111111111111';
process.env.REQUEST_HASH_SECRET = 'test-only-'.repeat(5);
function poolFixture(handler = async () => ({ rows: [] })) {
    const calls = [], released = [];
    const client = { query: async (sql, params) => { calls.push({ sql, params }); return handler(sql, params); }, release: broken => released.push(broken) };
    return { pool: { connect: async () => client }, calls, released, client };
}
test('tenant transaction sets local tenant context and uses one connection', async () => { const f = poolFixture(); await tenantTx(f.pool, tenant, async (c) => { assert.equal(c, f.client); await c.query('BUSINESS'); }); assert.equal(f.calls[0].sql, 'BEGIN'); assert.deepEqual(f.calls[1].params, [tenant]); assert.equal(f.calls.at(-1).sql, 'COMMIT'); assert.deepEqual(f.released, [false]); });
test('transaction errors roll back and release the connection', async () => { const f = poolFixture(); await assert.rejects(tenantTx(f.pool, tenant, () => { throw Error('business failure'); })); assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.deepEqual(f.released, [false]); });
test('a broken rollback destroys rather than recycles the connection', async () => { const f = poolFixture(async (sql) => { if (sql === 'ROLLBACK')
    throw Error('lost socket'); return { rows: [] }; }); await assert.rejects(tenantTx(f.pool, tenant, () => { throw Error('failure'); })); assert.deepEqual(f.released, [true]); });
test('an uncertain COMMIT is not automatically replayed', async () => { let invocations = 0; const f = poolFixture(async (sql) => { if (sql === 'COMMIT')
    throw Error('socket loss'); return { rows: [] }; }); await assert.rejects(tenantTx(f.pool, tenant, () => { invocations++; })); assert.equal(invocations, 1); });
test('runtime refuses superuser database credentials', async () => assert.rejects(assertRuntimeRole({ query: async () => ({ rows: [{ name: 'cs_api', rolsuper: true, rolbypassrls: false }] }) }), /non-owner/));
test('runtime refuses table-owning application role', async () => { let n = 0; await assert.rejects(assertRuntimeRole({ query: async () => ({ rows: ++n === 1 ? [{ name: 'cs_api', rolsuper: false, rolbypassrls: false }] : [{ exists: 1 }] }) }), /own tables/); });
test('idempotency returns stored response instead of running a second mutation', async () => {
    const user = { id: tenant, tenant_id: tenant };
    let stored, executions = 0;
    const c = { query: async (sql, p) => { if (sql.startsWith('SELECT request_hash'))
            return { rows: stored ? [stored] : [] }; if (sql.startsWith('INSERT INTO cs.idempotency_keys'))
            stored = { request_hash: p[4], response: JSON.parse(p[5]) }; return { rows: [] }; } };
    const first = await idempotent(c, user, 'create', 'test-key-0001', { b: 2, a: 1 }, async () => { executions++; return { id: tenant }; });
    assert.deepEqual(await idempotent(c, user, 'create', 'test-key-0001', { a: 1, b: 2 }, () => { throw Error('repeat'); }), first);
    assert.equal(executions, 1);
    await assert.rejects(idempotent(c, user, 'create', 'test-key-0001', { a: 2 }, () => { }), e => e.code === 'IDEMPOTENCY_CONFLICT');
});
test('enqueue uses a unique dedupe key and delayed durable availability', async () => { const f = poolFixture(); await enqueue(f.client, tenant, 'RECONCILE_UPLOAD', tenant, 300); const call = f.calls[0]; assert(call.sql.includes('ON CONFLICT')); assert.equal(call.params[4], 300); });
test('claim SQL uses skip-locked row locking, an attempt cap and a fresh lease token', async () => { const calls = []; await claimJob({ query: async (sql, p) => { calls.push({ sql, p }); return { rows: [] }; } }, 180); assert(calls[1].sql.includes('FOR UPDATE SKIP LOCKED')); assert(calls[1].sql.includes('attempts<max_attempts')); assert.equal(calls[1].p[1], 180); assert.match(calls[1].p[0], /^[a-f0-9-]{36}$/); });
test('stale worker cannot obtain a finalization fence', async () => assert.rejects(ownedJob({ query: async () => ({ rows: [] }) }, { id: tenant, tenant_id: tenant, lease_token: tenant }), e => e.code === 'LEASE_LOST'));
async function clamFixture(result, fn) { let received = Buffer.alloc(0), done = false; const server = net.createServer(socket => { let data = Buffer.alloc(0), header = false; socket.on('data', chunk => { data = Buffer.concat([data, chunk]); if (!header) {
    const n = data.indexOf(0);
    if (n < 0)
        return;
    assert.equal(data.subarray(0, n).toString(), 'zINSTREAM');
    header = true;
    data = data.subarray(n + 1);
} while (data.length >= 4) {
    const n = data.readUInt32BE(0);
    if (data.length < 4 + n)
        return;
    data = data.subarray(4);
    if (n === 0) {
        done = true;
        socket.end(result + '\0');
        return;
    }
    received = Buffer.concat([received, data.subarray(0, n)]);
    data = data.subarray(n);
} }); }); await new Promise(r => server.listen(0, '127.0.0.1', r)); try {
    await fn({ clamHost: '127.0.0.1', clamPort: server.address().port, scanTimeoutMs: 2000 }, () => ({ received, done }));
}
finally {
    await new Promise(r => server.close(r));
} }
test('ClamD client sends correct bounded INSTREAM frames', () => clamFixture('stream: OK', async (cfg, state) => { const bytes = Buffer.alloc(140000, 65); const r = await scanWithClamd(bytes, cfg); assert.equal(r.status, 'CLEAN'); assert(state().done); assert.deepEqual(state().received, bytes); }));
test('ClamD FOUND verdict prevents clean acceptance', () => clamFixture('stream: Test-Signature FOUND', async (cfg) => assert.equal((await scanWithClamd(Buffer.from('test'), cfg)).status, 'INFECTED')));
test('scanner errors fail closed rather than claiming CLEAN', () => clamFixture('INSTREAM size limit exceeded. ERROR', async (cfg) => assert.rejects(scanWithClamd(Buffer.from('test'), cfg), /SCAN_UNAVAILABLE/)));
test('connection refusal fails scanning', async () => { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); await assert.rejects(scanWithClamd(Buffer.from('test'), { clamHost: '127.0.0.1', clamPort: port, scanTimeoutMs: 1000 })); });
test('migration structurally includes RLS, composite FKs and immutable ledgers (not a database execution test)', async () => { const sql = await readFile(new URL('../migrations/001_core.sql', import.meta.url), 'utf8'); assert(sql.includes('FORCE ROW LEVEL SECURITY')); assert(sql.includes('FOREIGN KEY(tenant_id,campus_id,building_id)')); assert(sql.includes('calculation_immutable')); assert(sql.includes('UNIQUE(tenant_id,activity_id)')); assert(!sql.includes('BYPASSRLS;')); });

````


## scale-api/tests/browser-ui.py

````python
"""Optional renderer/interaction fixture: pip install playwright; playwright install chromium.
No backend network or cloud execution. Run python tests/browser-ui.py.
"""
import json,uuid,os,shutil
from types import SimpleNamespace
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
out=Path(os.environ.get('UI_ARTIFACT_DIR','ui-artifacts'));out.mkdir(parents=True,exist_ok=True)
u=lambda: str(uuid.uuid4())
tenant,person,campus,campus2,building,period,docid=[u() for _ in range(7)]
user={'id':person,'tenantId':tenant,'name':'UI Verification User','email':'ui@fixture.example','role':'ADMIN'}
meta={'tenant':{'id':tenant,'name':'UI TEST WORKSPACE - SYNTHETIC','storage_used_bytes':'10500','storage_quota_bytes':'1073741824'},'categories':{'PURCHASED_ELECTRICITY':['SCOPE_2','kWh'],'DIESEL':['SCOPE_1','litre'],'LPG':['SCOPE_1','kg']},'campuses':[{'id':campus,'name':'Main campus (test)'},{'id':campus2,'name':'Research campus (test)'}],'buildings':[{'id':building,'name':'Administration','campus_id':campus}],'periods':[{'id':period,'name':'FY 2026-27 (test)','status':'OPEN','start_date':'2026-04-01','end_date':'2027-03-31'}],'factors':[]}
dash={'totals':{'tonnes_co2e':'43.891345','calculated_records':'36','invoice_backed_records':'12'},'campuses':[{'id':campus,'name':'Main campus (test)','kg_co2e':'29500'},{'id':campus2,'name':'Research campus (test)','kg_co2e':'14391.345'}],'monthly':[],'pipeline':[{'status':'DRAFT','count':'2'},{'status':'SUBMITTED','count':'1'},{'status':'UNDER_REVIEW','count':'2'},{'status':'VERIFIED','count':'1'},{'status':'CALCULATED','count':'36'}],'jobs':[]}
records=[]
docs=[{'id':docid,'original_name':'synthetic-invoice.txt','mime_type':'text/plain','file_size':'124','sha256':'a'*64,'status':'REVIEW_REQUIRED','scan_result':'CLEAN','version':3,'extraction':{'fields':{'vendor':'Synthetic Utility','invoiceNumber':'TEST-001','amountInr':2000,'quantity':200,'activityDate':'2026-06-02','category':'PURCHASED_ELECTRICITY'},'warnings':['UI fixture only. Not a live malware verdict. Check original consumption.']}}]
requests=[];errors=[];checks=[]
def route_handler(route):
 r=route.request;p=urlparse(r.url).path;method=r.method;requests.append({'path':p,'method':method})
 body=r.post_data_json if method in ['POST','PATCH'] and 'application/json' in r.headers.get('content-type','') else None
 data={};status=200
 if p.endswith('/auth/login'): data={'user':user,'token':'fixture-session-only'}
 elif p.endswith('/auth/logout'):data={'loggedOut':True}
 elif p.endswith('/meta'):data=meta
 elif p.endswith('/dashboard'):data=dash
 elif p.endswith('/activities') and method=='GET':data={'items':records,'nextCursor':None}
 elif p.endswith('/activities') and method=='POST':
  assert isinstance(body['quantity'],str),'quantity must remain a string';assert body['unit']=='kWh';assert 'tenantId' not in body;assert r.headers.get('idempotency-key')
  a={'id':u(),'campus_id':body['campusId'],'period_id':body['periodId'],'building_id':body.get('buildingId'),'category':body['category'],'quantity':body['quantity'],'unit':body['unit'],'activity_date':body['activityDate'],'input_source':'MANUAL','status':'DRAFT','version':1,'created_by':person};records.append(a);data=a;status=201;checks.append('manual DTO uses decimal string, canonical unit, key; no caller tenant')
 elif p.endswith('/documents/upload'):
  assert r.headers.get('idempotency-key');assert r.headers.get('x-filename');assert r.headers.get('content-type')=='text/plain';checks.append('raw invoice upload includes MIME, filename and retry key');data={'id':u(),'status':'QUEUED'};status=202
 elif p.endswith('/documents'):data={'items':docs,'nextCursor':None}
 elif p.endswith('/documents/'+docid):data=docs[0]
 elif p.endswith('/confirm'):
  assert body['reviewConfirmed'] is True;assert body['quantity']=='200';assert body['amountInr']=='2000';checks.append('invoice DTO separates money and consumption; explicit human confirmation');data={'id':u()};status=201
 elif p.endswith('/jobs'):data={'items':[{'id':u(),'kind':'SCAN_INVOICE','status':'QUEUED','attempts':0,'max_attempts':5,'last_error':None}],'nextCursor':None}
 elif p.endswith('/campuses') and method=='POST':assert body['name']=='New Test Campus';checks.append('workspace setup form submits name/code without property collision');data={'id':u()};status=201
 else:raise AssertionError('Unexpected fixture API '+method+' '+p)
 route.fulfill(status=status,content_type='application/json',body=json.dumps({'success':True,'data':data,'requestId':u()}))
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('chromium') or None,headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1050},device_scale_factor=1)
 page.on('pageerror',lambda e:errors.append(str(e)))
 source=Path(__file__).resolve().parents[1]/'public'
 html=(source/'index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','').replace('<script defer src="/app.js"></script>','')
 page.set_content(html)
 page.add_style_tag(content=(source/'style.css').read_text())
 def binding(path,opts):
  output={}
  class FakeRoute:
   request=SimpleNamespace(url='https://fixture.invalid/api/v2'+path.removeprefix('/api/v2'),method=opts.get('method','GET'),post_data_json=json.loads(opts['body']) if isinstance(opts.get('body'),str) and 'application/json' in opts.get('headers',{}).get('Content-Type','') else None,headers={k.lower():v for k,v in opts.get('headers',{}).items()})
   def fulfill(self,**kwargs):output.update(kwargs)
  route_handler(FakeRoute());return output
 page.expose_function('fixtureApi',binding)
 page.evaluate("""() => { window.fetch=async(path,opts={})=>{ const plain={...opts};if(plain.body instanceof Blob)plain.body=await plain.body.text();const r=await window.fixtureApi(path,plain);return new Response(r.body,{status:r.status,headers:{'Content-Type':r.content_type}}); };if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)); }""")
 page.add_script_tag(content=(source/'app.js').read_text())
 page.screenshot(path=str(out/'login.png'),full_page=True)
 page.fill('[name=tenantId]',tenant);page.fill('[name=email]','ui@fixture.example');page.fill('[name=password]','UI-fixture-only-password');page.click('#loginForm button')
 page.wait_for_selector('#workspace:not([hidden])');page.wait_for_selector('.kpi-number')
 assert page.locator('.kpi-number').first.inner_text().startswith('43.89');checks.append('dashboard renders synthetic fixture quantities without runtime error')
 assert 'localStorage.setItem' not in (source/'app.js').read_text();assert 'sessionStorage.setItem' not in (source/'app.js').read_text();checks.append('source check: no auth token written to web storage')
 page.screenshot(path=str(out/'dashboard.png'),full_page=True)
 page.click('[data-view=entries]');page.click('[data-action=new]');page.wait_for_selector('#entryDialog[open]');page.fill('#entryForm [name=quantity]','123.456789');page.fill('#entryForm [name=activityDate]','2026-06-01');page.screenshot(path=str(out/'manual-entry.png'),full_page=True);page.click('#entryForm button[type=submit]');page.wait_for_selector('text=123.456789 kWh');checks.append('manual dialog saves and ledger renders new row')
 page.click('[data-view=invoices]');page.wait_for_selector('#invoiceFile');page.screenshot(path=str(out/'invoices.png'),full_page=True)
 page.click('[data-action=review-invoice]');page.wait_for_selector('#entryDialog[open]');assert page.locator('#entryForm [name=quantity]').input_value()=='200';assert page.locator('#invoiceReviewNotes').inner_text().startswith('UI fixture only');page.check('#entryForm [name=reviewConfirmed]');page.click('#entryForm button[type=submit]');page.wait_for_selector('#entryDialog',state='hidden');checks.append('invoice review displays extraction warning before confirmation')
 page.click('[data-view=invoices]');page.set_input_files('#invoiceFile',{'name':'upload-test.txt','mimeType':'text/plain','buffer':b'Synthetic invoice only'});page.click('[data-action=upload]');page.wait_for_function("document.querySelector('#notice').textContent.includes('Evidence received')")
 page.click('[data-view=jobs]');page.wait_for_selector('text=Scan Invoice');checks.append('queue page renders job state')
 page.click('[data-view=setup]');page.fill('[data-resource=campuses] [name=name]','New Test Campus');page.fill('[data-resource=campuses] [name=code]','NEW');page.click('[data-resource=campuses] button');page.wait_for_function("document.querySelector('#notice').textContent.includes('Workspace record created')")
 page.click('[data-view=overview]');page.wait_for_selector('.kpi-number');page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(out/'mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1');checks.append('390px mobile overview has no page-level horizontal overflow')
 assert page.locator('#logout').is_visible();page.click('#logout');page.wait_for_selector('#loginView:not([hidden])');checks.append('mobile logout clears the workspace')
 assert not errors,errors
 browser.close()
report={'checksPassed':len(checks),'checks':checks,'pageErrors':errors,'apiRequests':len(requests),'browser':'local Chromium / Playwright','backend':'Native Chromium renders local HTML/CSS/JS injected by test harness; fetch mocked. Browser loopback HTTP navigation was blocked by environment. Not a network/CSP/PostgreSQL/S3/ClamAV end-to-end test','screenshots':'Synthetic workspace fixtures, not customer data or production totals'}
(out/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))

````


## scale-api/tests/http.test.mjs

````javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http.mjs';
import { AppError } from '../src/core.mjs';
const tenant = '11111111-1111-4111-8111-111111111111';
const cfg = { production: false, origins: ['http://localhost:8080'], metricsToken: 'secret', maxInflight: 64, maxUploads: 2, maxUploadBytes: 100, trustProxy: false };
async function fixture(fn, overrides = {}, config = {}) {
    const services = { authenticate: async (h) => { if (h !== 'Bearer test')
            throw new AppError(401, 'UNAUTHENTICATED', 'Sign in'); return { id: tenant, tenant_id: tenant, role: 'ADMIN' }; }, limit: async () => { }, publicUser: u => u, readiness: async () => ({ ready: true }), metadata: async () => ({ name: 'Tenant A' }), login: async (b) => ({ email: b.email }), createActivity: async (u, b, k) => ({ body: b, key: k }), uploadLimit: async () => { }, upload: async (u, n, m, b, k) => ({ name: n, size: b.length, key: k }), ...overrides };
    const app = createApp({ ...cfg, ...config }, services, { log: () => { } });
    await new Promise(r => app.server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + app.server.address().port;
    try {
        await fn(base, app);
    }
    finally {
        await new Promise(r => app.server.close(r));
    }
}
const auth = { Authorization: 'Bearer test' };
test('liveness endpoint works without a session', () => fixture(async (base) => { const r = await fetch(base + '/healthz'); assert.equal(r.status, 200); assert.equal((await r.json()).data.service, 'carbonsynq-scale-api'); }));
test('business routes require authentication', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/meta')).status, 401)));
test('business response contains request ID and security headers', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { headers: auth }); assert.equal(r.status, 200); assert(r.headers.get('x-request-id')); assert(r.headers.get('content-security-policy').includes("object-src 'none'")); assert.equal((await r.json()).data.name, 'Tenant A'); }));
test('untrusted browser origins rejected', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/meta', { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403)));
test('allowed origin receives exact CORS header', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { headers: { ...auth, Origin: 'http://localhost:8080' } }); assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080'); }));
test('preflight supports required idempotency header', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080' } }); assert.equal(r.status, 204); assert(r.headers.get('access-control-allow-headers').includes('Idempotency-Key')); }));
test('metrics require a separate credential', () => fixture(async (base) => { assert.equal((await fetch(base + '/metrics')).status, 401); const r = await fetch(base + '/metrics', { headers: { Authorization: 'Bearer secret' } }); assert.equal(r.status, 200); assert((await r.text()).includes('carbonsynq_http')); }));
test('JSON content type is enforced', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/activities', { method: 'POST', headers: auth, body: '{}' })).status, 415)));
test('malformed JSON produces 400, not a stack trace', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' }); assert.equal(r.status, 400); assert.equal((await r.json()).error.code, 'INVALID_JSON'); }));
test('JSON array body rejected', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '[]' })).status, 422)));
test('JSON body has a strict 64 KiB limit', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(70000) }) })).status, 413)));
test('create routes forward the idempotency key', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/activities', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': 'test-key-0001' }, body: '{}' }); assert.equal(r.status, 201); assert.equal((await r.json()).data.key, 'test-key-0001'); }));
test('tenant IDs in query cannot redirect authorization', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/meta?tenantId=' + tenant, { headers: auth })).status, 422)));
test('raw invoice upload is bounded and URL-decodes the filename', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/documents/upload', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain', 'X-Filename': 'Invoice%201.txt', 'Idempotency-Key': 'test-key-0001' }, body: 'quantity: 1 kWh' }); assert.equal(r.status, 202); assert.equal((await r.json()).data.name, 'Invoice 1.txt'); }));
test('invoice size rejection happens before storage', () => fixture(async (base) => assert.equal((await fetch(base + '/api/v2/documents/upload', { method: 'POST', headers: { ...auth, 'Content-Type': 'text/plain', 'X-Filename': 'invoice.txt' }, body: 'a'.repeat(101) })).status, 413), { upload: async () => { throw Error('must not run'); } }));
test('readiness returns 503 when a dependency is not ready', () => fixture(async (base) => assert.equal((await fetch(base + '/readyz')).status, 503), { readiness: async () => ({ ready: false }) }));
test('internal service errors are sanitized', () => fixture(async (base) => { const r = await fetch(base + '/api/v2/meta', { headers: auth }); assert.equal(r.status, 500); assert(!(await r.text()).includes('PASSWORD')); }, { metadata: async () => { throw Error('PASSWORD=secret'); } }));
test('draining rejects new traffic safely', () => fixture(async (base, app) => { app.drain(); assert.equal((await fetch(base + '/healthz')).status, 503); }));
test('production transport advertises HSTS', () => fixture(async (base) => assert((await fetch(base + '/healthz')).headers.get('strict-transport-security')), {}, { production: true }));

````


## scale-api/tests/postgres.integration.mjs

````javascript
/** Real PostgreSQL integration suite; object storage and antivirus are controlled fixtures.
 * Requires an EMPTY disposable database whose name ends in _test. Does not delete data.
 * Not run by `npm test`: absence of infrastructure fails explicitly rather than passing a skip.
 */
import assert from 'node:assert/strict';
import { migrate } from '../scripts/migrate.mjs';
import { id, passwordHash, hash } from '../src/core.mjs';
import { createPool, tenantTx, assertRuntimeRole } from '../src/db.mjs';
import { login, authenticate } from '../src/auth.mjs';
import { createResource, approveFactor, setPeriod, updateUser } from '../src/management.mjs';
import { createActivity, getActivity, transition, confirmInvoice } from '../src/activities.mjs';
import { upload, download, getDocument } from '../src/documents.mjs';
import { claimJob, processCalculation, processInvoice, ownedJob, reconcileUpload } from '../src/jobs.mjs';
import { dashboard } from '../src/reporting.mjs';
import { createApp } from '../src/http.mjs';
import { services } from '../src/services.mjs';
const ownerUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!ownerUrl || !new URL(ownerUrl).pathname.endsWith('_test'))
    throw Error('Set TEST_DATABASE_ADMIN_URL to an EMPTY disposable PostgreSQL database ending in _test. No integration test was executed.');
const apiPass = process.env.TEST_API_PASSWORD || 'only-test-api-password-32-characters';
const workerPass = process.env.TEST_WORKER_PASSWORD || 'only-test-worker-password-32-characters';
process.env.REQUEST_HASH_SECRET = 'integration-test-HMAC-secret-not-for-production';
await migrate(ownerUrl, { apiPassword: apiPass, workerPassword: workerPass });
const { Client } = await import('pg');
const owner = new Client({ connectionString: ownerUrl });
await owner.connect();
const appURL = role => { const u = new URL(ownerUrl); u.username = role; u.password = role === 'cs_api' ? apiPass : workerPass; return u.href; };
const api = await createPool({ databaseUrl: appURL('cs_api'), ssl: false, poolMax: 10 });
const worker = await createPool({ databaseUrl: appURL('cs_worker'), ssl: false, poolMax: 5 });
let assertions = 0;
const tested = async (name, fn) => { await fn(); assertions++; console.log('PASS ' + name); };
const cfg = { production: false, origins: ['http://localhost:8080'], metricsToken: 'integration-metrics-token'.repeat(2), maxInflight: 64, maxUploads: 4, maxUploadBytes: 10485760, sessionHours: 8, trustProxy: false };
const objects = new Map();
const storage = {
    async check() { return true; },
    async put(key, bytes, mime) { const versionId = id(); objects.set(key, { bytes: Buffer.from(bytes), versionId, mime }); return { versionId }; },
    async get(key, version) { const o = objects.get(key); assert.equal(o.versionId, version); return o.bytes; },
    async head(key) { const o = objects.get(key); if (!o)
        throw Object.assign(Error('absent'), { name: 'NotFound' }); return { versionId: o.versionId, size: o.bytes.length, sha256: hash(o.bytes) }; }
};
let server;
try {
    const prior = await owner.query('SELECT count(*)::integer AS n FROM cs.tenants');
    assert.equal(prior.rows[0].n, 0, 'Use a fresh empty test database, not a live or previously populated schema.');
    await tested('non-owner application and worker roles', async () => { await assertRuntimeRole(api); await assertRuntimeRole(worker, true); });
    const password = 'Integration-only-Password-123!';
    const encoded = await passwordHash(password);
    async function fixture(name) {
        const tenant = id(), campus = id(), period = id(), people = {};
        await owner.query('BEGIN');
        try {
            await owner.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
            await owner.query('INSERT INTO cs.tenants(id,name) VALUES($1,$2)', [tenant, name]);
            for (const role of ['ADMIN', 'ENTRY', 'REVIEWER', 'LEADERSHIP']) {
                const uid = id();
                people[role] = { id: uid, tenant_id: tenant, role, email: role.toLowerCase() + '@integration.example' };
                await owner.query('INSERT INTO cs.users(id,tenant_id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5,$6)', [uid, tenant, role, people[role].email, role, encoded]);
            }
            await owner.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4)', [campus, tenant, 'Test Campus', 'TEST']);
            await owner.query('INSERT INTO cs.periods(id,tenant_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5)', [period, tenant, 'Test FY', '2026-04-01', '2027-03-31']);
            await owner.query('COMMIT');
        }
        catch (e) {
            await owner.query('ROLLBACK');
            throw e;
        }
        return { tenant, campus, period, ...people };
    }
    const a = await fixture('Integration tenant A'), b = await fixture('Integration tenant B');
    await tested('RLS with no context exposes zero tenants', async () => assert.equal((await api.query('SELECT * FROM cs.tenants')).rowCount, 0));
    await tested('tenant context cannot read another tenant or leak through pool reuse', async () => { await tenantTx(api, a.tenant, async (c) => { assert.equal((await c.query('SELECT * FROM cs.tenants')).rowCount, 1); assert.equal((await c.query('SELECT * FROM cs.users WHERE tenant_id=$1', [b.tenant])).rowCount, 0); }); assert.equal((await api.query('SELECT * FROM cs.users')).rowCount, 0); });
    await tested('RLS blocks cross-tenant inserts', async () => assert.rejects(tenantTx(api, a.tenant, c => c.query('INSERT INTO cs.campuses(id,tenant_id,name,code) VALUES($1,$2,$3,$4)', [id(), b.tenant, 'Bad', 'BAD'])), e => e.code === '42501'));
    await tested('worker cannot read password/session tables', async () => assert.rejects(worker.query('SELECT * FROM cs.users'), e => e.code === '42501'));
    const session = await login(api, { tenantId: a.tenant, email: a.ENTRY.email, password }, 'integration');
    await tested('opaque session authentication derives tenant and role', async () => { const u = await authenticate(api, 'Bearer ' + session.token); assert.equal(u.tenant_id, a.tenant); assert.equal(u.role, 'ENTRY'); assert.equal(u.password_hash, undefined); });
    const factorBody = { category: 'PURCHASED_ELECTRICITY', unit: 'kWh', value: '0.71', versionLabel: 'TEST-ONLY', source: 'SYNTHETIC integration factor; not for real reporting', sourceUrl: 'https://example.com/test-only', region: 'TEST', methodology: 'Synthetic test multiplication only', validFrom: '2026-04-01', validTo: '2027-03-31' };
    const factor = await createResource(api, a.ADMIN, 'factors', factorBody, 'factor-test-00001');
    await tested('factor author cannot approve their own factor', async () => assert.rejects(approveFactor(api, a.ADMIN, factor.id), e => e.code === 'SELF_APPROVAL'));
    await tested('separate reviewer approves factor and it becomes immutable', async () => { await approveFactor(api, a.REVIEWER, factor.id); await assert.rejects(tenantTx(api, a.tenant, c => c.query('UPDATE cs.factors SET value=1 WHERE id=$1', [factor.id])), e => e.code === '42501'); });
    const body = { periodId: a.period, campusId: a.campus, category: 'PURCHASED_ELECTRICITY', unit: 'kWh', quantity: '100.000001', activityDate: '2026-06-01', description: 'Integration test only' };
    let activity;
    await tested('parallel same-key create commits one activity and one audit', async () => { const [x, y] = await Promise.all([createActivity(api, a.ENTRY, body, 'manual-test-0001'), createActivity(api, a.ENTRY, body, 'manual-test-0001')]); assert.equal(x.id, y.id); activity = x; assert.equal((await owner.query("SELECT count(*)::int AS n FROM cs.audit_events WHERE entity_id=$1 AND action='ACTIVITY_CREATED'", [x.id])).rows[0].n, 1); });
    await tested('same idempotency key with another body conflicts', async () => assert.rejects(createActivity(api, a.ENTRY, { ...body, quantity: '102' }, 'manual-test-0001'), e => e.code === 'IDEMPOTENCY_CONFLICT'));
    await tested('cross-tenant resource IDs are not disclosed', async () => assert.rejects(getActivity(api, b.ADMIN, activity.id), e => e.code === 'NOT_FOUND'));
    await tested('leadership cannot create records', async () => assert.rejects(createActivity(api, a.LEADERSHIP, body, 'leader-test-0001'), e => e.code === 'FORBIDDEN'));
    const instance = createApp(cfg, services(api, storage, cfg), { log: () => { } });
    server = instance.server;
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    await tested('real HTTP + PostgreSQL list returns authenticated tenant data', async () => { const r = await fetch(base + '/api/v2/activities', { headers: { Authorization: 'Bearer ' + session.token } }); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.data.items.length, 1); assert.equal(j.data.items[0].id, activity.id); });
    await tested('stale workflow version does not advance record', async () => assert.rejects(transition(api, a.ENTRY, activity.id, 'submit', { version: 99 }), e => e.code === 'STALE_VERSION'));
    activity = await transition(api, a.ENTRY, activity.id, 'submit', { version: activity.version });
    activity = await transition(api, a.REVIEWER, activity.id, 'start-review', { version: activity.version });
    await tested('creator cannot approve even with administrator role', async () => assert.rejects(transition(api, { ...a.ENTRY, role: 'ADMIN' }, activity.id, 'verify', { version: activity.version, factorId: factor.id }), e => e.code === 'SELF_APPROVAL'));
    activity = await transition(api, a.REVIEWER, activity.id, 'verify', { version: activity.version, factorId: factor.id });
    await tested('verification atomically enqueues exactly one calculation job', async () => assert.equal((await owner.query("SELECT count(*)::int AS n FROM cs.jobs WHERE entity_id=$1 AND kind='CALCULATE'", [activity.id])).rows[0].n, 1));
    await tested('period with pending calculation cannot lock', async () => assert.rejects(setPeriod(api, a.ADMIN, a.period, { version: 1, reason: 'Integration close test' }, true), e => e.code === 'PENDING_ACTIVITIES'));
    const job = await claimJob(worker);
    assert.equal(job.entity_id, activity.id);
    await processCalculation(worker, job);
    await tested('NUMERIC calculation and monthly totals reconcile exactly', async () => { const row = await getActivity(api, a.ADMIN, activity.id); assert.equal(row.calculation.kg_co2e, '71.000001'); const dash = await dashboard(api, a.ADMIN); assert.equal(dash.totals.kg_co2e, '71.000001'); assert.equal(dash.totals.calculated_records, '1'); });
    await tested('stale lease cannot finalize a completed job', async () => assert.rejects(tenantTx(worker, a.tenant, c => ownedJob(c, job)), e => e.code === 'LEASE_LOST'));
    await owner.query("UPDATE cs.jobs SET status='QUEUED',available_at=now(),attempts=0 WHERE id=$1", [job.id]);
    const redelivery = await claimJob(worker);
    await processCalculation(worker, redelivery);
    await tested('job redelivery does not double-count a calculation', async () => { assert.equal((await dashboard(api, a.ADMIN)).totals.calculated_records, '1'); assert.equal((await owner.query('SELECT count(*)::int AS n FROM cs.calculations WHERE activity_id=$1', [activity.id])).rows[0].n, 1); });
    await tested('API cannot alter immutable ledger or audit', async () => { await assert.rejects(tenantTx(api, a.tenant, c => c.query('DELETE FROM cs.calculations WHERE activity_id=$1', [activity.id])), e => e.code === '42501'); await assert.rejects(tenantTx(api, a.tenant, c => c.query('DELETE FROM cs.audit_events WHERE entity_id=$1', [activity.id])), e => e.code === '42501'); });
    const bytes = Buffer.from('Vendor: Integration Utility\nInvoice Number: TEST-100\nDate: 2026-06-02\nConsumption: 200 kWh\nAmount: INR 2000');
    let doc = await upload(api, storage, a.ENTRY, 'test-invoice.txt', 'text/plain', bytes, 'invoice-test-0001');
    await tested('same upload retry returns one document and one storage object', async () => { const replay = await upload(api, storage, a.ENTRY, 'test-invoice.txt', 'text/plain', bytes, 'invoice-test-0001'); assert.equal(replay.id, doc.id); assert.equal(objects.size, 1); });
    await tested('unscanned invoice cannot download or create an activity', async () => { await assert.rejects(download(api, storage, a.ADMIN, doc.id), e => e.code === 'QUARANTINED'); await assert.rejects(confirmInvoice(api, a.ENTRY, doc.id, { ...body, quantity: '200', activityDate: '2026-06-02', version: doc.version, vendor: 'Test', invoiceNumber: 'TEST-100', reviewConfirmed: true }, 'invoice-confirm-01'), e => e.code === 'INVOICE_NOT_READY'); });
    const scanJob = await claimJob(worker);
    assert.equal(scanJob.kind, 'SCAN_INVOICE');
    await processInvoice(worker, storage, async () => ({ status: 'CLEAN', engine: 'CONTROLLED TEST FIXTURE - NOT ANTIVIRUS' }), async () => ({ ocrAvailable: false, fields: {}, warnings: ['Test fixture'] }), scanJob);
    doc = await getDocument(api, a.ADMIN, doc.id);
    await tested('after controlled scan fixture, pinned original bytes download intact', async () => assert.deepEqual((await download(api, storage, a.ADMIN, doc.id)).bytes, bytes));
    const invoice = await confirmInvoice(api, a.ENTRY, doc.id, { ...body, quantity: '200', activityDate: '2026-06-02', version: doc.version, vendor: 'Test Utility', invoiceNumber: 'TEST-100', amountInr: '2000.00', reviewConfirmed: true }, 'invoice-confirm-02');
    await tested('confirmed invoice separates money and quantity', async () => { assert.equal(invoice.quantity, '200.000000'); assert.equal(invoice.amount_inr, '2000.00'); assert.equal(invoice.document_id, doc.id); });
    const q = (await owner.query('SELECT storage_used_bytes FROM cs.tenants WHERE id=$1', [a.tenant])).rows[0];
    assert.equal(q.storage_used_bytes, String(bytes.length));
    await tested('tenant quota blocks a new document atomically', async () => { await owner.query('UPDATE cs.tenants SET storage_quota_bytes=storage_used_bytes WHERE id=$1', [a.tenant]); await assert.rejects(upload(api, storage, a.ENTRY, 'new.txt', 'text/plain', Buffer.from('Another valid invoice'), 'invoice-test-0002'), e => e.code === 'STORAGE_QUOTA'); await owner.query('UPDATE cs.tenants SET storage_quota_bytes=1000000 WHERE id=$1', [a.tenant]); });
    let uncertaintyId;
    await tested('ambiguous object PUT retains durable UPLOADING operation', async () => { await assert.rejects(upload(api, { ...storage, put: async () => { throw Error('transport failure'); } }, a.ENTRY, 'uncertain.txt', 'text/plain', Buffer.from('Uncertain invoice bytes'), 'uncertain-test-001'), e => e.code === 'STORAGE_UNCERTAIN'); uncertaintyId = (await owner.query("SELECT id FROM cs.documents WHERE tenant_id=$1 AND status='UPLOADING'", [a.tenant])).rows[0].id; });
    await owner.query("UPDATE cs.documents SET upload_deadline=now()-interval '1 second' WHERE id=$1", [uncertaintyId]);
    await reconcileUpload(worker, storage, a.tenant, uncertaintyId);
    await tested('missing-object reconciliation fails upload and releases reserved quota', async () => { assert.equal((await getDocument(api, a.ADMIN, uncertaintyId)).status, 'UPLOAD_FAILED'); assert.equal((await owner.query('SELECT storage_used_bytes FROM cs.tenants WHERE id=$1', [a.tenant])).rows[0].storage_used_bytes, String(bytes.length)); });
    await tested('last active admin cannot demote themselves', async () => assert.rejects(updateUser(api, a.ADMIN, a.ADMIN.id, { role: 'ENTRY', active: true }), e => e.code === 'LAST_ADMIN'));
    console.log(JSON.stringify({ suite: 'PostgreSQL integration', groupsPassed: assertions, storage: 'controlled in-memory fixture', antivirus: 'controlled fixture; NOT live ClamAV', database: 'real PostgreSQL', productionApproval: false }));
}
finally {
    if (server)
        await new Promise(r => server.close(r));
    await api.end();
    await worker.end();
    await owner.end();
}

````


## scale-api/tests/unit.test.mjs

````javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as c from '../src/core.mjs';
import { config } from '../src/config.mjs';
import { validateUpload } from '../src/storage.mjs';
import { parseInvoiceText } from '../src/invoice-text.mjs';
import { extractBounded } from '../src/scanner.mjs';
import { Metrics } from '../src/metrics.mjs';
const tenant = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const base = { periodId: tenant, campusId: other, category: 'PURCHASED_ELECTRICITY', unit: 'kWh', quantity: '12500', activityDate: '2026-09-01' };
const env = { DATABASE_URL: 'postgres://cs_api:p@localhost/db', WORKER_DATABASE_URL: 'postgres://cs_worker:p@localhost/db', ALLOWED_ORIGINS: 'http://localhost:8080', S3_BUCKET: 'evidence', METRICS_TOKEN: 'm'.repeat(40), REQUEST_HASH_SECRET: 'r'.repeat(40) };
const throws = (fn, code) => assert.throws(fn, e => e.code === code);
test('canonical request hashing ignores JSON key ordering', () => assert.equal(c.canonical({ b: 2, a: 1 }), c.canonical({ a: 1, b: 2 })));
test('decimal strings normalize without binary floating point', () => assert.equal(c.decimal('0.1'), '0.100000'));
for (const value of [1, '1e3', '-1', '01', '1.0000001', 'NaN', 'Infinity', '0', '1000000000000'])
    test(`reject invalid consumption ${JSON.stringify(value)}`, () => throws(() => c.decimal(value), 'INVALID_DECIMAL'));
test('zero money is allowed while zero consumption is not', () => assert.equal(c.decimal('0', 'money', 2, true), '0.00'));
test('exact multiplication keeps decimal result', () => assert.equal(c.multiplyDecimals('0.1', '0.2'), '0.020000'));
test('rounding half-up to six decimal places', () => assert.equal(c.multiplyDecimals('1', '0.000000500'), '0.000001'));
test('large products do not use JS safe-integer arithmetic', () => assert.equal(c.multiplyDecimals('999999999999', '1.000000001'), '1000000000999.000000'));
test('strict dates reject February overflow', () => throws(() => c.day('2026-02-30'), 'INVALID_DATE'));
test('leap date accepted', () => assert.equal(c.day('2028-02-29'), '2028-02-29'));
test('activity scope is derived from category', () => assert.equal(c.activityInput(base).scope, 'SCOPE_2'));
test('money cannot replace a consumption quantity', () => throws(() => c.activityInput({ ...base, quantity: undefined, amountInr: '1200' }), 'INVALID_DECIMAL'));
test('canonical unit mismatch rejected', () => throws(() => c.activityInput({ ...base, unit: 'INR' }), 'UNIT_MISMATCH'));
test('caller cannot select a tenant in an activity payload', () => throws(() => c.activityInput({ ...base, tenantId: other }), 'SERVER_OWNED_FIELD'));
test('caller cannot override the accounting scope', () => throws(() => c.activityInput({ ...base, scope: 'SCOPE_1' }), 'SERVER_OWNED_FIELD'));
test('semantic duplicate fingerprint is independent of description', () => assert.equal(c.fingerprint(c.activityInput(base)), c.fingerprint(c.activityInput({ ...base, description: 'Changed wording' }))));
test('duplicate override requires a substantive reason', () => throws(() => c.activityInput({ ...base, duplicateReason: 'yes' }), 'DUPLICATE_REASON'));
test('creator may submit own draft', () => assert.equal(c.workflow({ version: 1, status: 'DRAFT', created_by: tenant }, 'submit', { id: tenant, role: 'ENTRY' }, { version: 1 }).status, 'SUBMITTED'));
test('other data-entry user cannot submit', () => throws(() => c.workflow({ version: 1, status: 'DRAFT', created_by: tenant }, 'submit', { id: other, role: 'ENTRY' }, { version: 1 }), 'NOT_OWNER'));
test('leadership cannot approve', () => throws(() => c.workflow({ version: 1, status: 'UNDER_REVIEW', created_by: tenant }, 'verify', { id: other, role: 'LEADERSHIP' }, { version: 1 }), 'FORBIDDEN'));
test('admin cannot self-approve', () => throws(() => c.workflow({ version: 1, status: 'UNDER_REVIEW', created_by: tenant }, 'verify', { id: tenant, role: 'ADMIN' }, { version: 1 }), 'SELF_APPROVAL'));
test('separate reviewer can verify', () => assert.equal(c.workflow({ version: 1, status: 'UNDER_REVIEW', created_by: tenant }, 'verify', { id: other, role: 'REVIEWER' }, { version: 1 }).status, 'VERIFIED'));
test('stale writes are rejected before state mutation', () => throws(() => c.workflow({ version: 2, status: 'DRAFT', created_by: tenant }, 'submit', { id: tenant, role: 'ENTRY' }, { version: 1 }), 'STALE_VERSION'));
test('cannot skip review', () => throws(() => c.workflow({ version: 1, status: 'DRAFT', created_by: tenant }, 'verify', { id: other, role: 'REVIEWER' }, { version: 1 }), 'INVALID_STATE'));
test('reject requires reason', () => throws(() => c.workflow({ version: 1, status: 'SUBMITTED' }, 'reject', { role: 'REVIEWER' }, { version: 1, reason: 'no' }), 'REASON_REQUIRED'));
test('keyset cursor round-trip preserves timestamp and UUID', () => { const rows = [{ id: tenant, created_at: '2026-09-01T00:00:00.123Z' }, { id: other, created_at: '2026-09-01T00:00:00.122Z' }]; const p = c.page(rows, 1); assert.deepEqual(c.pagination({ cursor: p.nextCursor, limit: '1' }).cursor, [rows[0].created_at, tenant]); });
test('invalid cursors rejected', () => throws(() => c.pagination({ cursor: 'bad' }), 'INVALID_CURSOR'));
test('list requests cannot bypass the page cap', () => throws(() => c.pagination({ limit: '10000' }), 'INVALID_LIMIT'));
test('session tokens use random secrets and tenant-scoped hashes', () => { const a = c.sessionToken(tenant), b = c.sessionToken(tenant); assert.notEqual(a, b); assert.deepEqual(c.parseToken('Bearer ' + a), { tenantId: tenant, tokenHash: c.hash(a) }); });
test('malformed bearer rejected', () => throws(() => c.parseToken('Bearer abc'), 'UNAUTHENTICATED'));
test('password hashing uses async scrypt and verifies without plaintext storage', async () => { const h = await c.passwordHash('ExampleTest!LongPassword'); assert(!h.includes('ExampleTest')); assert(await c.passwordVerify('ExampleTest!LongPassword', h)); assert(!await c.passwordVerify('WrongPassword!', h)); });
test('short passwords rejected', async () => assert.rejects(c.passwordHash('short'), e => e.code === 'PASSWORD_POLICY'));
test('weak idempotency key rejected', () => throws(() => c.idempotencyKey('x'), 'IDEMPOTENCY_REQUIRED'));
test('internal errors never expose database messages', () => { const r = c.errorResponse(Error('postgres://secret/password SELECT sql'), 'request-1'); assert.equal(r.status, 500); assert(!JSON.stringify(r).includes('secret')); });
test('unique conflict has a safe machine-readable error', () => assert.equal(c.errorResponse({ code: '23505', detail: 'sensitive' }, 'req').status, 409));
test('default config is bounded and development only', () => { const cfg = config(env); assert.equal(cfg.production, false); assert.equal(cfg.maxUploads, 4); assert.equal(cfg.poolMax, 10); });
test('production rejects insecure database transport', () => assert.throws(() => config({ ...env, NODE_ENV: 'production' }), /DB_SSL/));
test('production rejects HTTP browser origins', () => assert.throws(() => config({ ...env, NODE_ENV: 'production', DB_SSL: 'true' }), /HTTPS/));
test('database URL cannot override TLS verification', () => assert.throws(() => config({ ...env, DATABASE_URL: env.DATABASE_URL + '?sslmode=no-verify' }), /sslmode/));
test('pool size has a hard bound', () => assert.throws(() => config({ ...env, DB_POOL_MAX: '1000' }), /DB_POOL_MAX/));
test('request digest secret is mandatory', () => assert.throws(() => config({ ...env, REQUEST_HASH_SECRET: '' }), /REQUEST_HASH_SECRET/));
test('file type uses bytes, not just extension', () => throws(() => validateUpload('invoice.pdf', 'application/pdf', Buffer.from('not PDF')), 'UNSUPPORTED_FILE'));
test('MIME spoof is rejected', () => throws(() => validateUpload('invoice.txt', 'image/png', Buffer.from('hello')), 'MIME_MISMATCH'));
test('filename cannot escape a directory', () => assert.equal(validateUpload('../../invoice.txt', 'text/plain', Buffer.from('hello')).name, 'invoice.txt'));
test('HTML and executable files are not accepted', () => throws(() => validateUpload('invoice.html', 'text/html', Buffer.from('<script>')), 'UNSUPPORTED_FILE'));
test('empty upload rejected', () => throws(() => validateUpload('invoice.txt', 'text/plain', Buffer.alloc(0)), 'EMPTY_FILE'));
test('upload size cap enforced', () => throws(() => validateUpload('invoice.txt', 'text/plain', Buffer.alloc(11), 10), 'FILE_TOO_LARGE'));
test('extraction never converts money into consumption', () => assert.equal(parseInvoiceText('Total amount: INR 12000').fields.quantity, undefined));
test('MWh is explicitly normalized to kWh with a warning', () => { const x = parseInvoiceText('Consumption: 2 MWh'); assert.equal(x.fields.quantity, 2000); assert(x.warnings.some(x => x.includes('converted'))); });
test('ambiguous invoice consumption lines force manual review', () => assert.equal(parseInvoiceText('Consumption: 2 kWh\nConsumption: 3 kWh').fields.quantity, undefined));
test('bounded extraction executes real text parsing in a worker thread', async () => { const x = await extractBounded(Buffer.from('Vendor: Test Supplier\nInvoice No: T-100\nConsumption: 100 kWh\nTotal amount: INR 950'), 'text/plain'); assert.equal(x.fields.quantity, 100); assert.equal(x.fields.amountInr, 950); assert.equal(x.ocrAvailable, false); });
test('real sample PDF parser is retained and works within the bounded worker', async () => { const b = await readFile(new URL('../../samples/sample-electricity.pdf', import.meta.url)); const x = await extractBounded(b, 'application/pdf'); assert.equal(x.fields.quantity, 12500); assert.equal(x.ocrAvailable, false); });
test('metrics expose bounded status labels, not personal IDs or paths', () => { const m = new Metrics(); m.observe(201, 0.05); const s = m.render(); assert(s.includes('status="201"')); assert(s.includes('duration_seconds_bucket')); assert(!s.includes('tenant')); });

````
