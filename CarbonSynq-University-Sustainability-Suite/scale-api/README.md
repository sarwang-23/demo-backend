> Latest release: **2.4.0 operations upgrade**. Read [../README-OPERATIONS-FIRST.md](../README-OPERATIONS-FIRST.md) first. The guide below describes the preserved earlier runtime/version.

# CarbonSynq Scale Foundation

**Version 2.0.0-rc.1 | Source delivery: 2 October 2026 | Staging validation required**

This adds a PostgreSQL-backed university consumption and invoice workflow, a separate durable worker, private versioned evidence storage and a leadership console. It is an additive **new `/api/v2` implementation**, not a completed migration of the supplied Neon application. The earlier local demo and original repository remain unchanged outside this folder.

## Choose the right entry point

| Purpose | Location | Command | Data |
| --- | --- | --- | --- |
| Existing CEO rehearsal | Parent folder | `npm start` / `START-BACKEND.cmd` | Existing local SQLite demo, illustrative factors |
| New scale foundation | This `scale-api/` folder | Steps below / parent `START-SCALE.cmd` | PostgreSQL + private S3 + separate worker; starts without emissions/factors |
| Preserved original service | Parent `original-neon-backend/` | Its own original instructions | Original TypeScript/Express/Neon source; not changed or newly verified |

**Do not deploy the parent SQLite demo as the scalable service.** Do not treat older verification reports as verification of this new module.

## First local integration startup

Required: Node.js 22.16+ (Node 24 is the container target), a running Docker engine with Compose v2, and Internet access to download packages, base images, a source-built local object-store fixture and ClamAV signatures. No `npm install` is needed on the host for the setup script; the image build installs the two runtime dependencies.

From the extracted project:

```bash
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose run --rm migrate node scripts/provision.mjs
```

The final command creates a new empty university, an administrator and a **different reviewer**, plus a campus, building and reporting period. It prints the tenant UUID and fresh credentials. Store them securely and change passwords after sign-in. Re-running provisioning creates another tenant; it is not a reset. There are no public demo credentials in this module.

Open `http://localhost:8080`, sign in with the printed **tenant ID + email + password**. The raw OpenAPI reference is `http://localhost:8080/openapi.json`.

On Windows, the parent `START-SCALE.cmd` performs setup and starts Compose, then prints the provisioning command. It does not fabricate an already-working deployment. Native Windows launcher execution and Docker startup were not verified in the delivery environment.

The first build may take significant time, especially the local object-store source build and antivirus signature download. Check `docker compose logs --tail=100 scanner worker api migrate storage-init` if a service is not healthy. Do not disable scanning to get a green screen.

## Your first genuine workflow

Create/approve a factor before calculating. An ADMIN registers the factor with category, canonical unit, value, validity dates, version, geography and source/methodology. A different ADMIN/REVIEWER approves it. No emissions factor is automatically considered official.

An ADMIN/ENTRY creates a manual draft, submits it, and a different reviewer starts review and verifies against an approved factor. Verification queues a durable calculation. Refresh after the worker processes it. The dashboard includes only CALCULATED activities.

For evidence: upload PDF/PNG/JPEG/TXT, wait for scanning, download/check the original, confirm actual consumption and save an invoice-linked draft. The same review/calculation workflow follows. Scanned pictures and unsupported PDF layouts require manual fields. **AI OCR is not connected.**

## What is implemented

Tenant-scoped PostgreSQL transactions and forced RLS; dedicated runtime database roles; exact decimal quantities and immutable calculations; shared rate-limit buckets; hashed, revocable sessions; role guards and independent approval; required create idempotency keys; optimistic record versions; keyset pagination; storage quota reservations; private version-pinned S3 evidence; upload reconciliation after uncertain failures; ClamD fail-closed scanning; bounded parser worker thread; PostgreSQL job leases/retry/dead-letter handling; calculated-only monthly aggregates; audit history; health/readiness/metrics; graceful shutdown; local Compose; migration/provision/backup/integrity scripts; new responsive console.

## Checks

```bash
npm test
npm run check
```

These run without installing external dependencies. **94 unit/HTTP/adapter tests passed** in the delivery environment. The existing parent demo's **43 tests passed** separately. UI checks used local Chromium with mocked API responses; they are not cloud end-to-end tests. See `docs/VERIFICATION.md` for exact evidence and limits.

Real PostgreSQL integration is a separate opt-in suite and requires dependency installation and a fresh disposable database ending in `_test`:

```bash
npm install --ignore-scripts
# Set TEST_DATABASE_ADMIN_URL in your shell to a fresh disposable *_test database.
npm run test:integration
```

This suite uses real PostgreSQL but controlled object-storage and scanner fixtures. It was **authored, not executed here**. The GitHub workflow under the parent `.github/workflows/scale-ci.yml` runs it when pushed to an environment with dependencies and PostgreSQL. No CI success is claimed before that run.

## Before live customers

Follow `docs/PRODUCTION-GATES.md`. In particular, run the real infrastructure tests, review dependency lockfiles/images, supply approved factor governance, perform tenant-isolation and hostile-file testing, configure TLS and private networking, test restore and failure recovery, and measure the target load. There is no verified concurrent-user capacity, availability SLA or production security certification in this delivery.

Read `docs/HLD.md`, `docs/API-WORKFLOW.md`, `docs/OPERATIONS.md`, `docs/MIGRATION-PLAN.md` and `docs/SECURITY.md`. `docs/HLD-AND-FULL-CODE.md` is the new module's consolidated design/source book; the earlier source books are preserved separately.
