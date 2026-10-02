# CarbonSynq - New folder ke liye Neon .env setup

Version: 2.4.0-operations-rc.1.env.1 | Configuration update only

## First: exposed credentials rotate karein

Chat mein paste hua database password, JWT secret aur Climatiq/Gemini/Affinda/Mistral API keys ko exposed treat karein. Provider dashboards se affected credentials revoke/rotate karein. Nayi values sirf apne local .env/secret manager mein enter karein; chat, screenshots ya Git mein mat bhejein. Is update ne koi remote credential rotate nahi kiya, provider account access nahi kiya, aur aapke Neon database se connect nahi kiya.

Neon: affected branch ke Roles section mein owner password reset karein, phir Connect se fresh URL lein. Already-open sessions may survive password reset; incident response mein affected sessions close/restart karna plan karein. Restart existing workloads ko interrupt kar sakta hai, isliye operator-controlled maintenance use karein. Old application still in use ho toh uska config bhi separately update karein. Workspace/document type IDs API credentials nahi hain, lekin yahan koi provider key required nahi hai.

## Correct folder and files

```text
CarbonSynq-University-Sustainability-Suite/
  README-ENV-FIRST.md
  START-NEON-5000.cmd
  START-NEON-5000.sh
  scale-api/
    .env                    # SAFE PLACEHOLDERS shipped; locally prepared secrets later
    .env.neon.example       # reusable secret-free template
    compose.neon.yaml       # Neon + local object storage + scanner
    scripts/prepare-neon-env.mjs
    scripts/check-neon-env.mjs
    docs/environment/SETUP.md
```

Root ka `npm start` old SQLite demo chalata hai. `original-neon-backend/.env` is new API ke liye nahi hai. Naye backend ki file **scale-api/.env** hai.

## Fresh Neon demo setup: recommended path

Use a separate demo branch/database, or an operator-approved staging database. This does not migrate the old public-schema/Neon application's records. The existing migration scripts create/update the `cs` schema and create missing `cs_api`/`cs_worker` roles when run. Do not point an unreviewed demo migration at live university data.

1. ZIP extract karke `scale-api/.env` open karein. **Entire DATABASE_OWNER_URL value** fresh rotated Neon URL se replace karein. Endpoint example aapke provided hostname se derived hai; target branch/host ko Neon Console mein confirm karein. Existing default endpoint ko live/production hone par demo ke liye use na karein.

2. Extracted project ke VS Code terminal mein:

```bash
cd scale-api
npm run env:prepare
npm run env:check
```

These two commands use Node built-ins; `npm install` is not needed for configuration preparation. Node.js 22.16+ is required by this project; the application Dockerfile uses Node 24. `env:prepare` local random secrets banata hai, role-specific URLs derive karta hai, SSL query options ko explicit settings mein convert karta hai aur existing valid secrets preserve karta hai. **No database connection, role creation, migration, email, or paid API call occurs here.**

Expected output from the check includes `valid: true`, `port: 5000`, and `databaseContacted: false`. This is offline validation, not a connection test.

3. Docker Engine/Desktop with Compose running ho, then:

```bash
npm run neon:up
npm run neon:status
```

`neon:up` checks configuration first, then uses **compose.neon.yaml**. It builds the app, starts local private versioned object storage and ClamAV, runs migrations against the selected Neon database, and starts API/worker. This command DOES make network connections and database changes on your machine. First scan-engine signatures/images/dependencies download hone mein time lag sakta hai. No scan bypass is provided.

4. **Fresh university tenant only**:

```bash
npm run neon:provision
```

This explicitly inserts a new university, admin/reviewer accounts, campus/building and period, and prints newly generated login credentials. Store them privately. It is not a password-recovery command. Re-running creates another tenant; existing installations should not run it again. No fake activities or emission factors are seeded.

5. Open:

```text
http://localhost:5000/university
http://localhost:5000/university/imports
http://localhost:5000/operations
```

Separate frontend dev origin `http://localhost:3000` is allowed. This enables CORS only: it does NOT adapt your existing frontend's routes/DTOs/login automatically. New API prefix is `/api/v2`; use bearer sessions as implemented, not the legacy JWT flow.

## What changed from the old environment

| Old setting | New interpretation |
|---|---|
| PORT=5000 | Preserved for host access. Containers listen on internal 8080; localhost:5000 maps to it. |
| NODE_ENV=development | Preserved. This profile is not for public production. |
| FRONTEND_ORIGIN | Replaced by ALLOWED_ORIGINS; includes frontend 3000 and same-origin backend 5000. |
| PUBLIC_BASE_URL | http://localhost:5000; account links use this trusted origin. |
| DATABASE_URL using neondb_owner | Owner URL goes in DATABASE_OWNER_URL only. API uses cs_api and worker uses cs_worker. |
| sslmode=require in URL | Normalized away after preparation; DB_SSL=true creates certificate-verified pg TLS config. |
| channel_binding=require in URL | Normalized away; DB_CHANNEL_BINDING=true enables node-postgres channel binding when offered. This is NOT a guarantee of libpq's mandatory require semantics. |
| JWT_SECRET | Not used by scale-api; sessions are opaque database-backed tokens. Do not reuse the leaked old JWT secret as another key. |
| GEMINI_*, AFFINDA_*, MISTRAL_* | Not read by the current scale-api. Adding keys alone does not integrate those services. |
| CLIMATIQ_*, DEFAULT_INVOICE_REGION | Not a wired external-factor integration in scale-api. Factor catalog/approval remains the app's governed workflow. |
| GENERIC_PURCHASED_GOODS_KGCO2E_PER_PCS=5 | Not used as a blanket emission factor. No default assumption is promoted into approved accounting. |
| OCR_MAX_PAGES etc., DISABLE_HEAVY_PDF_OCR | Old provider/parser knobs are not used here. OCR_ENABLED=true enables the existing local English OCR job; scanner, Tesseract and human review remain required. |

## Why direct Neon URLs in this profile?

A copied `-pooler` hostname is converted to direct by the helper. Owner migrations already use session advisory locks. The existing pg runtime also sets per-connection statement timeouts. Direct connections avoid claiming that those session settings are transaction-pooler safe. Each application process still uses a bounded client pool of 5 connections; this is not unlimited or a benchmark. Pooler mode should be introduced only with a reviewed driver/session-state change and live tests.

The old comment 'shared transaction-mode pooler (IPv4-only)' is not copied as a verified network property. Confirm endpoint reachability from your actual host. No live DNS/database test was performed here.

Runtime roles must be created through the included SQL migration path, not manually as Neon Console privileged roles. API/worker startup checks reject owner or BYPASSRLS identities. No authorization, malware scan, independent review or tenant-isolation check was bypassed to make setup easier.

## Which secrets are created locally?

DB_API_PASSWORD, DB_WORKER_PASSWORD, AWS_SECRET_ACCESS_KEY (local object store), METRICS_TOKEN, REQUEST_HASH_SECRET and MAIL_ENCRYPTION_KEY are generated on your machine. They are not copies of any posted credentials. Existing valid settings survive reruns; URL/password conflicts stop preparation instead of silently changing them.

`AWS_REGION=us-east-1` is the local object-store signing region, not the Neon database location. Container services use internal hosts `object-store` and `scanner`; host-based Node processes use loopback settings from .env. Real S3/IAM requires a different reviewed production profile.

MAIL_MODE=capture means NO email is sent. Development email content exists only in the worker's temporary private capture directory; it is not durable delivery. This update does not configure a mail webhook/provider. Existing operation docs explain authorized local capture inspection.

## Existing installations

Do not overwrite an existing .env, regenerate persisted encryption keys, or replace an existing object-storage volume. Use the template as a mapping reference and retain existing runtime credentials/secrets. The helper refuses profiles other than neon-local development. If cs_api/cs_worker already exist, use their real current passwords/URLs; migrations create missing roles but do not reset existing role passwords. Generating different passwords locally does not rotate remote roles.

The new Compose project name is `carbonsynq-neon-local`, with its own object/scanner volumes. It does NOT automatically reuse old local storage. An existing deployed installation needs an operator-reviewed database and exact evidence-object migration/backup plan before switching profiles. Never use `docker compose down -v` as a setup fix; it removes local volumes.

## Troubleshooting

- Placeholder/invalid-owner error: replace the entire owner URL using the fresh console string. Special password characters must be URL-encoded; copying the correctly encoded URL avoids manual mistakes.
- Conflicting shell environment error: old exported DATABASE_URL/NODE_ENV/etc. can override .env. Open a clean terminal or clear conflicting application variables. Checks intentionally print no values.
- Password authentication failure for cs_api/cs_worker: existing role passwords may differ. Preparation is offline and does not reset them.
- Runtime role rejected: use dedicated non-owner role URLs, not the owner URL in DATABASE_URL.
- Port occupied: stop the conflicting old backend, or change PORT, PUBLIC_BASE_URL and both backend origins together; rerun env:check.
- Scanner starting / missing signatures: wait and inspect logs; never bypass scanning.
- Missing .env or .env.txt: filename must be exactly .env inside scale-api. The helper can copy the safe example when the file is absent, then stops for owner input.
- Do not paste output of `docker compose config`, full environment dumps or URLs into chat. Use `npm run env:check` for a credential-free result.

```bash
npm run neon:logs
npm run neon:down
```

`neon:down` stops/removes containers but does not request volume deletion; it does not delete remote Neon data. Services are loopback-only, including the local storage/admin ports.

## Verification boundary

See VERIFICATION.md for measured checks. No exposed credentials were used. No remote Neon role/password/database or external API was tested, changed, or contacted. Native Windows launcher execution, Docker build/start, dependency installation, storage/scanner round-trip and full frontend integration remain to be run on your machine.

## Technical sources checked

- Neon connection types and transaction-pooling restrictions: https://neon.com/docs/connect/connection-pooling
- Neon role creation/privilege differences and password reset: https://neon.com/docs/manage/roles
- Neon TLS: https://neon.com/docs/connect/connect-securely
- node-postgres explicit SSL and channel binding: https://node-postgres.com/features/ssl
- Docker environment interpolation and precedence: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/

These sources document provider behavior; they are not evidence this application was deployed successfully.
