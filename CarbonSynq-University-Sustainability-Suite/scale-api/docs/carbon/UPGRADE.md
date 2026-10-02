# Installation and upgrade

## Fresh local installation

Use Node.js 22.16+ (the supplied application image targets Node 24), Docker Compose, internet access and available disk space for images, database, object storage and antivirus definitions. The local tests used Node 22.16.0. This is a local integration stack, not a public production deployment recipe.

From the extracted project root:

```bash
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose run --rm migrate node scripts/provision.mjs
```

`setup` creates local environment secrets only when appropriate; do not replace an existing environment with new passwords. Provisioning is for a new tenant and prints its tenant ID, administrator credentials and separate reviewer credentials. No default public production account is added by this upgrade. Save those credentials securely. Open `http://localhost:8080/university`, sign in and choose **Scope 1 & 2**. Existing `START-UNIVERSITY.cmd` / `.sh` launchers remain in the root.

The antivirus engine may take time to download signatures. Check worker/scanner logs when evidence remains in quarantine. No upload-scan bypass was introduced. The new carbon module has no alternative public evidence upload: use the existing private invoice/document workflow, then reference the stored clean document ID.

The root-level `npm start` still launches the older SQLite demonstration. It does not launch this integrated PostgreSQL suite.

## Existing scale-api installation

Do not run tenant provisioning again for an existing university. Do not run `docker compose down -v`, delete database volumes, reset production data, overwrite `.env`, rotate secrets accidentally or edit migrations 001/002.

1. Schedule maintenance and freeze writes. Record application commit/version, database schema version and current deployment configuration.
2. Back up PostgreSQL using a dedicated backup-capable role and verify the dump is readable. Retain every pinned S3 object version and the current bucket policy/versioning configuration. The existing database dump script does not copy S3 bytes. Retain a secure copy of `.env`/secrets separately; generated code ZIPs must not contain live secrets.
3. Restore a staging copy first. Apply the additive migration003 through the existing migration runner. Test the upgrade and real acceptance suite before touching the live database.
4. Deploy updated code. In the local Compose setup the maintenance commands are:

```bash
cd scale-api
docker compose stop api worker
docker compose build
docker compose run --rm migrate
docker compose up -d api worker
docker compose ps
```

5. Check all three migration versions, API readiness, worker/scanner/storage health, authentication, legacy data totals and a fresh enhanced test period. Resume writes only after reconciliation.

Existing report snapshots, Scope 3, KPI, supplier and historical Scope 1/2 records are not automatically recalculated. Existing factors are not copied into the new factor table because source kind, gas coverage and location/market applicability require a review.

## Activating enhanced Scope 1/2

Use an OPEN period with no active legacy Scope 1/2 rows. Register physical accounting sources and a separately approved factor catalog. Assess every campus/source, attach boundary evidence and obtain independent boundary approval. This activates the exclusive new ledger for that period. The app rejects old-ledger Scope 1/2 writes afterwards.

A period with old non-rejected Scope 1/2 records cannot be silently switched. For a demonstration use a clean period. For historical migration, prepare an external reconciliation plan and a tested migration with approvals; this package does not include a one-click conversion. Do not delete old data merely to bypass this gate.

## Rollback

This migration is additive but extends views/triggers used by the application. There is no automatic down migration. Restore the verified database/object-store backup and compatible application version together, or prepare a separately reviewed forward fix. Do not assume that deploying an older binary alone is a safe database rollback. `upgrade-backup/university-v2.1/` contains original code/document versions, not a live database backup.

## Local checks without infrastructure

```bash
cd scale-api
npm test
npm run check:university
npm run carbon:demo
```

These commands do not replace real integration acceptance. `carbon:demo` uses a disposable in-memory test store and prominently labels every factor/evidence value synthetic. It does not seed or mutate a real tenant.

## Real acceptance

After installing declared dependencies on a connected staging machine, create a disposable PostgreSQL database whose name ends in `_test` and set `TEST_DATABASE_ADMIN_URL` to a privileged setup connection. Do not point tests at a live tenant database. Run the existing core and university acceptance suites plus:

```bash
npm run test:carbon:postgres
```

The script itself validates the `_test` suffix and creates uniquely named test fixtures. API requests inside the tests use a non-owner role. Review `PRODUCTION-GATES.md`; passing this suite alone does not validate S3, the scanner, browser integration or load.
