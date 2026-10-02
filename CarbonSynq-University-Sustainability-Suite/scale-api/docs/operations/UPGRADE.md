# Upgrade and startup - operations 2.4.0 RC

Read this guide before older READMEs. Root `npm start` still runs the preserved SQLite demo. New features run inside `scale-api`.

## Fresh local integration setup

Prerequisites: Node.js 22.16+ (Docker runtime targets Node 24), Docker with Compose, working Internet/registries and enough memory/disk for PostgreSQL, object storage and ClamAV signatures. No hosted resources are provisioned by this package.

```bash
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose run --rm migrate node scripts/provision.mjs
```

Provisioning prints the new tenant ID and administrator/reviewer credentials. Store them privately and change initial passwords. It intentionally does not create real-looking activity data or approved factors. Existing users can be managed through the university console; account invitations are now available in Operations.

Open `http://localhost:8080/operations`. Existing university/Scope 1/2 is `/university`; spreadsheet and invoice workbench is `/university/imports`; recovery/invitation acceptance is `/account`.

Fresh `setup` creates only a local development `.env`, with new random encryption material, mail capture and English OCR enabled. Capture is NOT email. No setup command overwrites an existing `.env`. The scanner still must be healthy; never bypass CLEAN checks to make a demo succeed.

## Existing installation: do not provision another university

1. Stop new submissions; arrange a maintenance window. Retain the current deployment files, .env, secrets, database and exact object versions. Perform and validate your established backup before applying a migration.
2. Review migration 005 and restrictive evidence defaults. Documents without sharing metadata will now be private to uploaders and university-wide roles. Plan explicit grants/memberships for departmental users.
3. Preserve all old environment values. Add the new operations settings deliberately; do not replace the old encryption/storage credentials. Migrations 001-004 are unchanged; do not edit applied migration SQL.
4. Stop the old API/worker. Build the new image and apply migrations using the migration identity. Start API and worker only after migration 005 succeeds. For the supplied LOCAL Compose environment:

```bash
docker compose stop api worker
docker compose build api worker migrate
docker compose run --rm migrate
docker compose up -d api worker
```

5. Recheck role grants, tenant isolation, old documents, representative tasks, import/review/calculation and the production gates. Do not run the older application against migration 005 as an unreviewed rollback. A rollback needs a restored coordinated snapshot or a reviewed forward fix.

## Explicit operations settings for an existing local .env

To demonstrate invitations without email, set MAIL_MODE=capture and OCR_ENABLED=true. Set PUBLIC_BASE_URL=http://localhost:8080. Generate MAIL_ENCRYPTION_KEY once with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Save that 64-hex-character value privately in .env. Do not print it in reports or commit it. Production rejects capture and requires a trusted HTTPS PUBLIC_BASE_URL. Production mail requires the separately configured webhook provider described in MAIL-RELAY.md.

Local Compose keeps captured messages in a worker-only tmpfs; they are not accessible from the browser and disappear when that container is recreated. Inspect a development message explicitly:

```bash
docker compose exec worker node scripts/read-local-mail.mjs
docker compose exec worker node scripts/read-local-mail.mjs <outbox-uuid>.json
```

The second command displays a sensitive one-use link. Never share a capture directory or terminal recording. Reissue an invitation if the capture vanished. A real mail provider is not connected by reading this file.

## Scanned invoices

Upload normally in the existing intake workbench. Wait for actual antivirus CLEAN. Before importing rows, use Request English OCR. Inspect job status in Operations, refresh the intake file, normalize again and review every value. Up to 10 pages per request; scanned handwriting/non-English/complex content can require manual entry. PDFs with good text layers continue to use their native text.

## Inventory exports

Lock the period in the university workspace. Operations -> Inventory exports -> Generate export. The worker produces a CSV/JSONL and READY status. A different reviewer downloads Review bytes, checks totals/provenance and approves. Leadership then downloads approved bytes. A QUEUED item is not a finished report. Old narrative-report limits are unchanged.

## Tests and local checks

```bash
npm test
npm run check:university
npm run operations:preflight
npm run test:operations:ocr
```

The last command intentionally runs an actual synthetic OCR smoke test once; ordinary tests do not repeatedly run OCR. Set TEST_DATABASE_ADMIN_URL to a disposable database whose name ends in _test before `npm run test:operations:postgres`. That script creates labelled fixtures and never wipes a schema, but must not point to live data.

There is no new npm dependency in this upgrade. Registry-enabled build/lockfile verification still has to be completed. `npm install` is needed for a direct native PostgreSQL deployment; the old zero-install SQLite demo is a different runtime.
