# Start here - CarbonSynq University Operations upgrade

Release **2.4.0-operations-rc.1**. Existing university, Scope 1/2, Excel normalization and multi-PDF intake are retained. New code adds evidence sharing controls, staff invitations/recovery, operational reassignment, notifications, local English OCR, asynchronous inventory exports and backup-integrity tools.

**Runtime:** use `scale-api/`, not root npm start. The root command still launches the preserved SQLite demonstration. The original Neon repository remains separate and is not silently migrated.

## Fresh local setup

```bash
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose run --rm migrate node scripts/provision.mjs
```

Open `http://localhost:8080/operations`. Main university: `/university`; uploads: `/university/imports`. Use the tenant ID and private credentials printed by provisioning. Fresh setup enables local mail capture and English OCR; capture DOES NOT send email. Docker, registries and real scanner/storage/database connectivity are required.

**Existing deployment:** do not overwrite .env or provision another university. Read `scale-api/docs/operations/UPGRADE.md` and take a coordinated backup. Migration 005 is additive, but evidence defaults become private for ENTRY accounts; review necessary grants. Migrations 001-004 are unchanged.

Read `FEATURE-STATUS.md`, `HLD.md`, `VERIFICATION.md`, `PRODUCTION-GATES.md` and `CEO-DEMO-GUIDE.md` in `scale-api/docs/operations/`. `HLD-AND-FULL-CODE.md` contains a reproducible complete integrated source listing. Older guides/codebooks are historical version snapshots, not the latest feature status.

This is tested application code and a release candidate, **not an assertion that all infrastructure, mail delivery, restoration or production security has been verified**. Exact original copies of changed input files are in `upgrade-backup/ingestion-v2.3/`; the preservation manifest lists them.
