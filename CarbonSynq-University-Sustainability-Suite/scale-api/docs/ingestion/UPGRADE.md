# Setup and upgrade - import release

## Fresh local integration stack

Prerequisites: Node.js 22.16+ (Node 24 container target), Docker with Compose, Internet access for images/packages/signatures. The host does not need Python when running the supplied Docker image. The image installs the parser dependencies.

From the extracted project:

```sh
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose run --rm migrate node scripts/provision.mjs
```

Provisioning prints the new tenant ID and separate admin/reviewer credentials. Keep them private. There are no fixed public university production credentials. Open `http://localhost:8080/university` for source, factors, boundary and reviewer setup, and `http://localhost:8080/university/imports` for the new workbench.

The scanner may take time to download signatures. Wait for scanner/worker readiness. Do not disable scanning just to make uploads appear successful. Use `docker compose logs --tail=100 api worker migrate scanner` to inspect failures without sharing secrets.

**Root `npm start` still runs the OLD SQLite demo. It does not contain this new ingestion feature.**

## Existing Scope 1/2 installation

Use staging first. Preserve `.env`, PostgreSQL volumes, object-storage volumes, credentials and all existing records. Do not rerun setup or tenant provisioning against an established deployment. No automatic old-demo/Neon migration is included.

1. Rehearse database and object-storage backup/restore. Stop intake and allow or stop workers safely.
2. Deploy updated source with the existing environment; do not copy public test credentials.
3. Ensure database/storage/scanner dependencies are running. Stop API and worker writers.
4. Build and apply additive migration 004 with the owner migration role, then restart the runtime roles.

```sh
cd scale-api
docker compose stop api worker
docker compose build api worker migrate
docker compose run --rm migrate
docker compose up -d api worker
docker compose ps
```

Do not edit checksums of already-applied 001-003 migrations. The API runs as `cs_api`, not the database owner. The worker remains `cs_worker`; it does not receive access to review tables. Existing document records need not be rewritten. Re-uploading an existing file may return its known document ID; use explicit existing-document attachment after checking tenant/owner and status.

Rollback is not an automatic down migration: retain a tested pre-upgrade backup and reconcile any new drafts/receipts before restoring. Never delete evidence or imported rows to force a downgrade.

## Host-only local parsing/tests

The offline normalization example does not need Docker, PostgreSQL or npm dependency installation, but does need Python packages and Poppler on PATH:

```sh
cd scale-api
python3 -m venv .parser-venv
.parser-venv/bin/pip install -r python/requirements-test.txt
export PARSER_PYTHON="$PWD/.parser-venv/bin/python3"
# Install Poppler with your operating system package manager.
npm test
npm run ingestion:example -- ./import-example-output
```

PowerShell uses `.parser-venv\Scripts\python.exe` and `$env:PARSER_PYTHON` instead of the Unix activation/path syntax. Native Windows execution was not verified in the delivery environment. The Docker route is the provided cross-platform stack route.

The local example writes normalized-preview.xlsx, normalized-preview.json and six-invoice-preview.json, and **zero database drafts**. It is not a fake running production backend.
