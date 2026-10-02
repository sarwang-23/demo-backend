# CarbonSynq University Backend - High-Level Design

Version: full-source delivery 1.0.1, 2026-10-02

## 1. Scope and architectural decision

The delivered system implements a complete **local demonstration** of manual consumption capture and invoice-backed consumption capture, with reviewer approval, emissions calculation, leadership reporting and audit history. It is deliberately isolated from the uploaded Express/TypeScript/Drizzle/Neon backend so the demonstration does not depend on remote database credentials or unavailable npm packages.

All 242 files of the original uploaded project, including `original-neon-backend/src/`, migrations and tests, are byte-preserved under `original-neon-backend/`. The runnable local application now sits at the ZIP root. The new module is not wire-contract-identical to the original service, does not migrate its records and does not upgrade an existing deployment. Similar domain names and `/api/v1` paths are reused for familiarity, not as a claim of compatibility.

### Implemented local topology

```text
Browser: offline HTML / CSS / JavaScript
  | same-origin HTTP on 127.0.0.1:5050
  v
Node HTTP routing + JSON/multipart limits + host/origin checks
  |
  +-- Session authentication --> tenant from authenticated database user
  +-- Role authorization ------> admin / entry / reviewer / leadership
  |
  +-- Activity service --------> validation, duplicates, versioned workflow
  +-- Invoice service ---------> file signature, SHA-256, text suggestions
  +-- Calculation service -----> approved consumption x versioned factor
  +-- Reporting service -------> calculated-only totals and exports
  +-- Audit service -----------> before/after events with request IDs
  |
  v
Local SQLite database, foreign keys, WAL, parameterized SQL
  +-- university / campuses / buildings / users / sessions
  +-- reporting periods / illustrative emission factors
  +-- documents: original bytes + extraction + reviewed fields
  +-- activities / immutable calculation snapshots / audit events
```

There is one process and one local database. No remote service, queue, cloud storage or OCR provider is required. The built-in SQLite API was exercised on Node 22.16.0. On that runtime it is experimental; a warning is expected. The server binds only to loopback and refuses `NODE_ENV=production`.

## 2. Primary use cases

**Manual entry:** choose the university reporting period, campus/building, category, date and actual consumption. Preview an illustrative estimate without writing. Save a draft, submit, review, verify and calculate.

**Invoice entry:** upload one PDF/PNG/JPEG/TXT. Validate type/size and store exact bytes, hash and uploader. Suggest fields from supported readable text, or require manual fields. An explicit human confirmation creates one draft linked to the original document. The same approval/calculation workflow follows.

**Leadership:** read the calculated inventory, inspect Scope 1/2, campuses, category mix, pending work and invoice evidence coverage. Export calculation rows and factor provenance. Leadership cannot create, approve or modify activities.

## 3. Data model and invariants

`schema.sql` is the executable database definition.

| Entity | Responsibility and relationships |
| --- | --- |
| universities | Root tenant; all operational records are university-scoped. |
| campuses / buildings | University hierarchy. Composite foreign keys protect tenant relationships; application validation also verifies building-to-campus membership. |
| users / sessions | Role, tenant, scrypt password hash; only hashes of random session tokens persist. |
| reporting_periods | University date range and OPEN/LOCKED state. |
| emission_factors | Category, scope, canonical unit, validity dates, source label and version. Demo catalog is shared and read-only through the API. |
| documents | Original file BLOB, size, MIME, filename, SHA-256, extracted suggestions, reviewed JSON, status and version. Tenant-scoped unique file hash and normalized logical invoice key. |
| activities | Quantity/unit/date, campus/building, period, category/scope, source, optional invoice, owner, reviewer, status and optimistic version. |
| calculations | One row per activity; quantity and factor value/version/source are snapshotted with kgCO2e. |
| audit_logs | Actor, tenant, action, entity, before/after JSON, request ID and timestamp. Application/trigger append-only. |
| idempotency_keys | Manual-create retry key, actor, route, request digest and resulting activity. |

Invoices have a one-to-one link to a consumption activity in this demo. Multi-line invoices, split allocations, combining multiple evidence documents per activity and invoice replacements are not implemented. An amount in INR is informational and never used as the consumption quantity. The demo uses SQLite REAL / JavaScript Number; production money and precision requirements need an explicit decimal policy.

Tenant identity is derived from the authenticated user. Supplying a different `universityId` is rejected. Cross-tenant IDs return not-found or authorization errors without exposing the record. There is no public account registration or tenant-provisioning API.

## 4. Workflow and transaction boundaries

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> VERIFIED -> CALCULATED
                         |
                         +-> REJECTED -> edit/correct -> DRAFT
```

The creator (or an administrator) can edit/delete draft or rejected entries and submit drafts. A reviewer or administrator performs review transitions. **No actor, including an administrator, can verify their own entry.** Starting review does not constitute approval. Calculation requires prior verification. Activity mutations check tenant, role, open period and the expected record version. The admin period lock/unlock controls are separate audited operations. Repeated calculation of an already-calculated record returns the existing result without adding another calculation.

A manual insert, invoice link, workflow update and associated audit event are committed in the same SQLite transaction where applicable. Invoice byte storage and upload metadata/audit are also atomic. Optimistic versions reject stale writes with HTTP 409. Idempotency keys make retries of the same manual-create request return the same record; a different payload using the same key conflicts. Request idempotency does not replace domain-level duplicate checks.

Potential duplicate manual entries compare period/campus/building/date/category/unit/quantity. A genuinely separate matching entry requires explicit override and a justification, recorded in the audit event. Invoice file hashes block repeated bytes; normalized vendor + invoice number block different files representing the same reviewed invoice. These are useful safeguards, not a universal fraud-detection solution.

Only CALCULATED activities join the emissions totals. Draft, submitted, under-review, rejected and merely verified records contribute no emissions. A locked reporting period blocks activity writes and linking/calculation; an admin can lock even with pending entries. Lock/unlock is implemented in the API, not as a UI management screen.

## 5. Invoice processing and extraction boundary

1. Authenticate and authorize an entry/admin user.
2. Enforce one uploaded file, a 10 MB file limit, allowed extension/MIME and content signature checks. JSON requests have a separate 64 KB limit.
3. Compute SHA-256, reject duplicates within the tenant and preserve the original bytes.
4. For text files and supported standard-font unencrypted PDFs, inspect readable text. The lightweight PDF reader handles supported ASCII85/Flate streams with bounded decompression. Complex font encodings, encrypted documents and image-only scans fall back to manual review.
5. Look for explicit vendor, invoice number, ISO date, consumption quantity/unit and INR amount labels. Multiple consumption lines are treated as ambiguous; currency-only fields cannot become a quantity. An explicit MWh value is normalized to kWh with a visible warning.
6. Show the original and suggestions together. Require actual consumption, hierarchy, date, category and the review checkbox before creating a draft.

`ocrAvailable` is always false in this build. No confidence scores or OCR outputs are fabricated. Parsing succeeds for the included synthetic simple-text PDFs, not for every real invoice. File signatures are not malware scanning. Production uploads require quarantine, malware scanning and a hardened parser/OCR isolation boundary before processing or previewing untrusted content.

## 6. Calculation and reporting

```text
kgCO2e = canonical consumption quantity x factor (kgCO2e / canonical unit)
tCO2e  = kgCO2e / 1000
```

Demo catalog, version `DEMO-v1`, valid 2026-04-01 through 2027-03-31:

| Category | Scope | Canonical unit | Illustrative factor |
| --- | --- | --- | --- |
| Purchased electricity | 2 | kWh | 0.71 |
| Diesel | 1 | litre | 2.68 |
| Petrol | 1 | litre | 2.31 |
| LPG | 1 | kg | 2.98 |
| Natural gas | 1 | m3 | 2.02 |

These are explicitly **unverified illustrative assumptions**, not official regional emission factors or a compliance methodology. The demo does not implement Scope 3, market-based Scope 2, renewable certificates, offsets, credits, gases/GWP decomposition or uncertainty analysis. Official factor selection must consider geography, year, fuel properties, accounting boundary and the required methodology.

The seed creates a synthetic Greenfield University with two campuses, six buildings, six months of historical records, 36 calculated entries and two pending entries. Campus, category and scope totals use the calculated subset of the same ledger included in exports. CSV/JSON exports include pending activity rows for transparency; only calculated rows have emissions/factor values. Evidence coverage means the **count** of calculated records linked to invoices divided by all calculated records, not the share of emissions audited or independently assured. Reporting never adds kWh, litres and kg into a meaningless combined consumption total.

## 7. API contract and errors

See `openapi.json` and `/api-docs` for the method-level reference. Public routes are `/`, static assets, synthetic sample files, `/health` and login. All business API routes require `Authorization: Bearer <token>`.

Main groups: `/api/v1/auth/*`, `/meta`, `/activity-data/*`, `/documents/*`, `/dashboard`, `/emission-factors`, `/audit-logs`, `/reports/*`, `/reporting-periods/:id/lock|unlock`.

Success normally returns `{success:true,data,requestId}`. Errors return `{success:false,error:{code,message,details?},requestId}`. Download/export routes return bytes rather than that envelope. HTTP status families include 400 malformed input, 401 authentication, 403 authorization, 404 not found, 409 stale/duplicate/workflow conflicts, 413 size, 415 content type, 422 validation and 429 rate limit. Internal errors expose a request ID, not SQL or a stack trace.

## 8. Security controls and their limits

Implemented: tenant filtering on every business read/write, composite tenant foreign keys, role guards, maker-checker separation, scrypt passwords, 8-hour sessions, revocable session hashes, same-origin/host allowlists, parameterized queries, content security headers, no browser token persistence, bounded requests, upload checks, duplicate detection and audit history. Login is limited to 60 attempts per 15 minutes per local IP for rehearsal role switching; business requests to 300 per minute per user. These are process-memory limits, not distributed abuse prevention.

Audit triggers forbid ordinary update/delete of audit rows. They are **not cryptographic tamper evidence**: an operator with database file access can alter the schema or replace the file. The database and backups are not encrypted by this application. All demo credentials and role-switch shortcuts are public. Localhost binding is a demonstration boundary, not a substitute for production security engineering.

## 9. Operations and recovery

Startup seeds only an empty local database. A PID lock helps prevent two copies using the same demo data directory. The default directory is `.local-data`; override with `DEMO_DATA_DIR` only when deliberately changing storage. `DEMO_PORT` changes the local port. Stop the server before backup/reset. Backups use the SQLite backup API; reset renames and retains the previous data directory instead of deleting it. Invoice bytes travel with the database backup.

Local storage has a per-file size limit but no tenant total quota or retention engine. One SQLite writer and synchronous lightweight parsing are appropriate only for this demo's load. No throughput, concurrent-user SLA, browser support matrix or security penetration test is claimed.

## 10. Audit of the supplied original service

The following observations informed the isolated demo design; they are not claims that the original source has been fixed:

- `original-neon-backend/src/services/documentsV1.ts` contains mock OCR values rather than extracting the invoice. Its OCR-to-activity path uses invoice money as quantity and hardcodes a scope.
- The original create-from-OCR controller does not establish a tenant check equivalent to the new module's authenticated ownership checks.
- Several original manual-entry routes have no authentication middleware.
- The original storage description references served `/files`, but the inspected `app.ts` does not mount the corresponding static route.
- The original demonstration seeder clears application tables; it must not be used against live university data.
- Automatic HTTP-database retry logic must not assume that a network error proves a mutation did not commit; production writes need idempotency.
- The supplied schema covers Scope 1/2, not a complete Scope 3 inventory.

The previous delivery reported that original dependency installation was blocked by registry connectivity. This source-delivery pass did not retry that installation, run the original TypeScript build/Vitest suite, or contact Neon. The current passing test results apply only to the root local application. All original source files were checked against the uploaded ZIP by SHA-256.

## 11. Production integration plan - NOT implemented

| Stage | Required work and acceptance gate |
| --- | --- |
| Contract alignment | Map original controllers/DTOs/schema and frontend expectations. Freeze canonical units, statuses, role policy and API versioning. Test backward compatibility before switching clients. |
| Original service hardening | Apply authenticated tenant-scoped access to every route, replace mock OCR, separate money from quantity, centralize approval invariants and add idempotent writes. |
| Persistence | Design PostgreSQL/Neon migrations with tenant composite constraints, unique calculation and evidence keys, decimal precision and rollback/reconciliation scripts. Run against a staging copy first. |
| Evidence ingestion | Store files in private object storage, upload to quarantine, scan for malware, process through an isolated worker queue, integrate an approved OCR provider and review uncertain fields. Never let invoice text execute instructions or actions. |
| Identity | University SSO/MFA, invitation/provisioning, least privilege, environment-specific secrets, secure production session transport and no public demo credentials. |
| Accounting governance | Obtain approved factors and provenance, define organization/operational boundaries, set period approval/reopening rules and independent review expectations. |
| Operations | TLS/reverse proxy, production health/metrics/logging, storage quotas, backup/restore drills, retention, monitoring and incident processes. |
| Validation | Contract and browser regression tests, tenant-isolation tests, file-security review, dependency audit, load testing and signed business acceptance with real anonymized invoices. |

Suggested production topology: browser -> identity-aware API -> PostgreSQL + private object storage; upload queue -> isolated malware-scan/parser/OCR worker -> human review -> deterministic calculation service. This is a roadmap, not infrastructure included in the ZIP.

## 12. Technical reference

Node.js v22.16.0 SQLite API: https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html . This explains the built-in database API used here; it does not certify this application's design or security. Refer to `VERIFICATION.md` for measured results, and to executable tests for exact assertions.


## 13. Repository and implementation map

This delivery rearranges the previously isolated local module into the ZIP root so `npm start` runs the correct application without installing the original project's dependencies. The original 242 repository files are preserved byte-for-byte under `original-neon-backend/`; they are not imported by `server.mjs`.

```text
CarbonSynq-Complete-Backend-With-HLD/
  package.json               # zero third-party runtime dependencies at root
  server.mjs                 # API/router and startup
  schema.sql                 # executable SQLite definition
  tools.mjs                  # backup/reset CLI
  lib/
    auth.mjs                 # password/session checks
    activities.mjs           # entry + workflow + calculation
    invoices.mjs             # upload + suggestions + review link
    dashboard.mjs            # metadata + dashboard + reports + audit reads
    db.mjs                   # database + transactions + seed + audit writes
    shared.mjs               # input validators + roles + illustrative factors
    runtime.mjs              # local PID lock
  public/                    # demo UI and API reference
  samples/                   # synthetic test invoices
  examples/                  # executable API journey + HTTP examples
  tests/                     # unit / HTTP integration / operations
  docs/                      # HLD, full source book, OpenAPI and verification
  original-neon-backend/      # original uploaded code, not integrated
```

### Service-to-file responsibilities

| Logical module | Implementation | Main operations |
| --- | --- | --- |
| Authentication | `lib/auth.mjs` | `login`, `authenticate`, `logout` |
| Access control | `lib/shared.mjs`, `lib/activities.mjs`, router | Role allowlists, authenticated tenant, record ownership |
| Activity entry | `lib/activities.mjs` | `validateActivity`, `createActivity`, `updateActivity`, `deleteActivity`, `preview` |
| Workflow and calculation | `lib/activities.mjs` | `transition`, `findFactor`, one calculation per verified activity |
| Evidence ingestion | `lib/invoices.mjs` | `validateFile`, `extractInvoice`, `uploadInvoice`, `confirmInvoice` |
| Reporting | `lib/dashboard.mjs` | `dashboard`, `report`, `reportCsv`, `auditList`, `metadata` |
| Persistence | `lib/db.mjs`, `schema.sql` | `openDatabase`, `transaction`, `seed`, `audit` |
| HTTP/lifecycle | `server.mjs` | Route dispatch, envelopes, limits, origin/host checks, graceful stop |
| Local operations | `tools.mjs`, `lib/runtime.mjs` | Lock, consistent backup, confirmed non-destructive reset |

This is a modular monolith: a single local process imports separate service modules. It is not a collection of independently deployed microservices.

## 14. Complete runnable API route matrix

Authoritative request/response definitions are in `docs/openapi.json`. These are the root demo's routes, not the contract of the original service. Relative paths below use `http://localhost:5050` during a normal local run.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check local service and database |
| `POST` | `/api/v1/auth/login` | Sign in with a local demo account |
| `GET` | `/api/v1/auth/me` | Get the authenticated identity |
| `POST` | `/api/v1/auth/logout` | Revoke the current bearer session |
| `GET` | `/api/v1/meta` | Get tenant, campuses, buildings, periods and categories |
| `GET` | `/api/v1/emission-factors` | Get illustrative factor catalog |
| `GET` | `/api/v1/dashboard` | Get calculated-only operational dashboard |
| `GET` | `/api/v1/activity-data` | List consumption activities |
| `POST` | `/api/v1/activity-data` | Create a manual draft |
| `POST` | `/api/v1/activity-data/preview` | Preview a consumption estimate without writing |
| `GET` | `/api/v1/activity-data/{id}` | Get a tenant-owned activity and calculation |
| `PATCH` | `/api/v1/activity-data/{id}` | Edit a draft or rejected record |
| `DELETE` | `/api/v1/activity-data/{id}` | Delete a draft or rejected record |
| `POST` | `/api/v1/activity-data/{id}/submit` | Submit an activity |
| `POST` | `/api/v1/activity-data/{id}/start-review` | Start review an activity |
| `POST` | `/api/v1/activity-data/{id}/verify` | Verify an activity |
| `POST` | `/api/v1/activity-data/{id}/reject` | Reject an activity |
| `POST` | `/api/v1/activity-data/{id}/calculate` | Calculate an activity |
| `GET` | `/api/v1/documents` | List original invoice evidence |
| `POST` | `/api/v1/documents/upload` | Upload one original invoice |
| `GET` | `/api/v1/documents/{id}` | Get invoice metadata and suggested/reviewed fields |
| `GET` | `/api/v1/documents/{id}/download` | Download the exact original bytes |
| `POST` | `/api/v1/documents/{id}/create-activity` | Confirm reviewed fields and create an invoice-linked draft |
| `GET` | `/api/v1/audit-logs` | List tenant audit events |
| `GET` | `/api/v1/reports/summary` | Get full activity ledger and calculated-only summary |
| `GET` | `/api/v1/reports/export` | Download a JSON or CSV report |
| `POST` | `/api/v1/reporting-periods/{id}/lock` | Lock a reporting period |
| `POST` | `/api/v1/reporting-periods/{id}/unlock` | Unlock a reporting period |

### How the frontend should integrate

1. Call login; keep the returned opaque bearer token in memory.
2. Call `/api/v1/meta`; use returned campus/building/reporting-period IDs rather than hardcoding random seed IDs.
3. Create or preview an activity using the fields below. Render validation errors without changing the amount into consumption.
4. Every edit/workflow request sends the **latest** `version` returned by the previous response. On 409, reload and reconcile rather than blindly resubmitting.
5. After a mutation, reload the detail/dashboard. Do not add preview values into a persisted inventory total.
6. For invoice uploads, use `FormData` with one field named `file`; let the HTTP client set the multipart boundary. Human review is required before linking.
7. Distinguish API envelopes from file/report responses: downloads and CSV/JSON exports return raw bytes or report JSON.

The same-origin UI is included. A separate browser frontend on a different port is deliberately rejected by the local backend's origin/host policy. Serve the included UI, or design and test an explicit development-origin policy before moving to another frontend origin. This is not an unrestricted CORS API.

## 15. Manual-entry sequence with exact fields

Fetch real IDs from `/api/v1/meta`. A JSON create request has this shape:

```json
{
  "reportingPeriodId": "ID_FROM_META",
  "campusId": "ID_FROM_META",
  "buildingId": "ID_FROM_META_OR_OMIT",
  "category": "PURCHASED_ELECTRICITY",
  "quantity": 1250,
  "unit": "kWh",
  "activityDate": "2026-10-02",
  "description": "Academic block electricity - demo"
}
```

`buildingId` is optional; omit it when not allocating to a building. The placeholder strings are documentation, not IDs to send unchanged. The executable example resolves these IDs for you.

```text
Data-entry account
  POST /auth/login
  GET  /meta
  POST /activity-data/preview     -> estimate only, no ledger write
  POST /activity-data             -> DRAFT, version 1
       Idempotency-Key: unique request key
  POST /activity-data/:id/submit  -> {"version":1}, returns version 2

Different reviewer account
  POST /auth/login
  POST /activity-data/:id/start-review -> send latest version
  POST /activity-data/:id/verify       -> send latest version
  POST /activity-data/:id/calculate    -> send latest version

Leadership account
  GET /dashboard
  GET /reports/summary
```

All paths above except login are under `/api/v1`; full routes are in section 14. The example of 1,250 kWh times the illustrative 0.71 factor gives 887.5 kgCO2e. It is a arithmetic demo result, not an approved inventory factor.

## 16. Invoice sequence with exact fields

`POST /api/v1/documents/upload` accepts one multipart file; the response includes document ID, version, extraction suggestions and review status.

To create a draft from the uploaded synthetic sample:

```json
{
  "version": 1,
  "reviewConfirmed": true,
  "reportingPeriodId": "ID_FROM_META",
  "campusId": "ID_FROM_META",
  "buildingId": "ID_FROM_META_OR_OMIT",
  "category": "PURCHASED_ELECTRICITY",
  "quantity": 12500,
  "unit": "kWh",
  "activityDate": "2026-09-30",
  "description": "Synthetic sample invoice",
  "vendor": "Greenfield Utilities (Demo)",
  "invoiceNumber": "DEMO-ELEC-2026-0930",
  "amountInr": 112500
}
```

Send it to `/api/v1/documents/:id/create-activity`. The request's `version` refers to the **document**; the returned activity then has its own workflow version. Do not set `reviewConfirmed` automatically for real incoming invoices: the human must compare the original evidence and actual consumption. The executable fixture does this only for supplied synthetic values.

```text
Upload bytes -> signature/size/tenant/hash validation
             -> stored original + suggestions + REVIEW_REQUIRED
             -> person checks quantity, units, date and vendor
             -> create linked DRAFT atomically + audit
             -> submit -> separate reviewer -> calculate
```

The sample's 12,500 kWh and INR 112,500 remain different fields. The demo calculation is 8,875 kgCO2e. OCR is not configured; an image upload is usable evidence with manual entry, not a claim of image-to-text extraction.

## 17. Original repository context and non-integration boundary

The original source uses an Express router mounted at `/api/v1` and separate TypeScript controllers/services/validators, with Drizzle schema and migrations for its database. Its source tree includes auth/onboarding, university and campus hierarchy, activity data, documents/imports, factor taxonomy, calculations, reporting, targets, baselines, recommendations, notifications and audit routes. Presence of code is **not** evidence that all those modules work, are tenant-safe or have been tested in this delivery.

```text
original-neon-backend/src/app.ts
  -> src/routes/index.ts
  -> src/routes/v1/*.ts
  -> src/controllers/*.ts
  -> src/services/*.ts + src/validators/*.ts
  -> src/db/index.ts + src/db/schema/*.ts
  -> original Drizzle/Neon data path
```

The archive keeps original package/lock files and all original data assets. No third-party dependencies, secrets or remote database credentials are installed or supplied for that application. The original `/api/v1` names do not imply matching payloads with the root demo. Integration requires explicit DTO/schema/unit/workflow/auth mapping, database migrations and staging acceptance. The observations in section 10 are still unresolved in the preserved original source.

## 18. Full-source reference and verification

`docs/HLD-AND-FULL-CODE.md` embeds this HLD, then verbatim root application code, UI, examples, tests, SQL/OpenAPI/configuration, followed by original application source, tests, SQL migrations and selected configuration. Large data exports, binary invoices/screenshots and original instruction/documentation assets are preserved in the ZIP, not converted into code blocks. The ZIP is the runnable artifact; the Markdown source book is for review/search, not execution.

`docs/ORIGINAL-SOURCE-MANIFEST.json` lists all 242 original files with byte counts and SHA-256 hashes. `docs/SOURCE-CATALOG.json` inventories this delivery. `docs/VERIFICATION.md` records fresh execution results, measured runtime and exact limits. No production readiness or emissions compliance certification follows from a passing test suite.
