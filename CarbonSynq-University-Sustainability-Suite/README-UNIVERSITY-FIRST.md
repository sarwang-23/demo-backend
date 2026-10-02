> Historical release reference (university v2.1). The current Scope 1/2 upgrade is documented in `README-SCOPE12-FIRST.md`; its added methods and verification supersede earlier feature-limit statements. Original version is retained in `upgrade-backup/university-v2.1/`.

# CarbonSynq University Sustainability Suite

**Start here. Version 2.1.0-university-rc.1 | Delivery: 2026-10-02**

This package extends the existing PostgreSQL `scale-api/`. It does not add another disconnected server. The university routes, authentication, private invoice evidence, audit events and deployment share the same `/api/v2` application. Source code and additional HLD are included.

## Exactly which application should I run?

| Location | Purpose | Open in browser |
|---|---|---|
| Root `server.mjs`, `npm start` | Earlier SQLite demonstration, preserved | `http://localhost:5050` |
| `original-neon-backend/` | Original supplied TypeScript/Neon repository, preserved | Original setup instructions; not migrated or tested in this upgrade |
| `scale-api/` | Scale foundation plus the integrated university extension | `http://localhost:8080/university` |
| `scale-api/` core console | Existing Scope 1/2, private invoices and administration | `http://localhost:8080/` |

**Running `npm start` at the root does not start the new university suite.**

## Fresh local installation (Windows / macOS / Linux)

Install Node.js 22.16 or later (Docker image targets Node 24), Docker with Compose, and have Internet access for image/dependency/signature downloads. Then open a terminal in this extracted project:

```bash
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 migrate api worker scanner
docker compose run --rm migrate node scripts/provision.mjs
```

The last command creates a NEW university and prints its tenant ID, administrator credentials, reviewer credentials, campus ID and period ID. Save credentials privately and change passwords. No real user credentials or `.env` secrets are bundled. No factors or measurements are seeded.

Open `http://localhost:8080/university`. Sign in with the printed university ID, email and password. Use **Data collection -> Install 22 KPI definitions** as the administrator. This installs definitions only. Use the core console to create additional campuses, reporting periods, ENTRY users and a read-only LEADERSHIP user. Required reference choices in the university UI show the first 100 records; the API listings support pagination.

The included `START-UNIVERSITY.cmd` and `.sh` perform local setup/start, then show the provisioning command. They do not provision tenants automatically or reset data. Windows launcher execution was not verified on a Windows host.

## Existing installation: do not provision it again

Read `scale-api/docs/university/UPGRADE.md`. Preserve the existing `.env`, PostgreSQL volume and private object storage. Back up and test restoration before applying migration 002. Existing accounts/campuses/activities stay in place. Neither the SQLite demo nor the older Neon database is automatically converted into this PostgreSQL schema.

## What is implemented?

22 university KPI templates and custom KPIs; collection assignments and revisions; private evidence reuse; manual/CSV carbon activities; additional Scope 1/2 and relevant Scope 3 categories; all-15-category boundary screening; separate student commuting/travel; supplier questionnaires and single-use portals; exploratory materiality surveys; frozen reviewed reports; absolute reduction targets and initiative tracking; optional PCF screening; deterministic, record-linked insights; a new dark university console and API workflow studio.

API reference: `http://localhost:8080/university/openapi.json`. Existing core API reference: `/openapi.json`. See `scale-api/docs/university/FEATURE-MATRIX.md` for the screenshot-to-feature mapping, implemented boundaries and unavailable connectors.

## Test commands

```bash
cd scale-api
npm test
npm run check:university
```

These are dependency-free local tests. They **do not substitute for PostgreSQL or production testing**. Real database suites require the `pg` dependency and a disposable PostgreSQL database ending in `_test`:

```bash
npm install --ignore-scripts
npm run test:integration
npm run test:university:postgres
```

Set `TEST_DATABASE_ADMIN_URL` and test-role passwords as described in the test files. The original integration suite requires an empty test database; run it before the university integration suite. Both fail explicitly when no test database is configured. Never point them to a real university database.

For a read-only live application smoke check set `UNIVERSITY_TENANT_ID`, `UNIVERSITY_EMAIL`, `UNIVERSITY_PASSWORD`, optionally `UNIVERSITY_API_ORIGIN`, then run `npm run university:smoke`.

## Honesty boundary

This is a source-code release candidate with passing local tests, not a certified production deployment. Live PostgreSQL/S3/ClamAV/Docker integration, native browser navigation/CSP, production load, security assessment and restore drills remain acceptance gates. No LLM/OCR provider, ERP/IoT connector, automatic email, SSO/MFA, billing, regulatory filing, ISO-certified PCF or verified net-zero claim is included. See `scale-api/docs/university/VERIFICATION.md` and `PRODUCTION-GATES.md`.
