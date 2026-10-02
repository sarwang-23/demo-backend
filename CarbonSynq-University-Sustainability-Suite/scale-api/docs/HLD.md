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
