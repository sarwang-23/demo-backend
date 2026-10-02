> Latest release: **2.4.0 operations upgrade**. Read [README-OPERATIONS-FIRST.md](README-OPERATIONS-FIRST.md) first. The guide below describes the preserved earlier runtime/version.

# CarbonSynq - Complete Backend Source + HLD

**Is package mein actual editable source code hai, sirf design ya sample snippets nahi.**

The root application is the independently runnable **local university demo backend**. The full original Express/TypeScript/Drizzle/Neon project is preserved separately in `original-neon-backend/`. They are **two different implementations**, not an integrated deployment or interchangeable API contracts.

## Sabse pehle run karo

ZIP completely extract karo. Extracted `CarbonSynq-Complete-Backend-With-HLD` folder ko VS Code mein open karo. Isi folder ke terminal mein:

```sh
node --version
npm start
```

Windows par `START-BACKEND.cmd` double-click bhi kar sakte ho. macOS/Linux: `sh START-BACKEND.sh`.

Browser:

```text
http://localhost:5050
http://localhost:5050/api-docs
```

Root demo ko **npm install, Neon credentials, .env, internet, API key ya OCR service ki zaroorat nahi hai** after Node is installed. Node version manifest: 22.16+ within 22.x, or 24+. Actual retest runtime: Node v22.16.0 on Linux. Its SQLite experimental warning is expected. No claim of testing all supported versions is made.

Do not start `original-neon-backend/` for the CEO demo. The commands in this README apply at the root only.

## Code aur HLD kahan hai?

| File/folder | Purpose |
| --- | --- |
| `docs/HLD.md` | Architecture, data model, manual/invoice workflows, API matrix, security boundaries, deployment roadmap and original-code comparison. |
| `docs/HLD-AND-FULL-CODE.md` | HLD followed by the verbatim runnable source and original application source/config/migration code. Datasets and binary samples remain in the ZIP. |
| `server.mjs` | HTTP routes, request limits, errors, authorization dispatch and server lifecycle. |
| `lib/activities.mjs` | Manual entry, edit/delete, idempotency, duplicates, workflow and calculations. |
| `lib/invoices.mjs` | Upload validation, text suggestions, original evidence, confirmation and linked draft creation. |
| `lib/auth.mjs` | Login, logout, sessions and identity checks. |
| `lib/db.mjs` + `schema.sql` | Local SQLite setup, transactions, audit writes and synthetic seed. |
| `lib/dashboard.mjs` | Metadata, calculated-only dashboard, reporting and exports. |
| `lib/shared.mjs` + `lib/runtime.mjs` | Validators, demo factor catalog, role helpers and runtime lock. |
| `public/` | Included browser UI; useful for showing the backend workflows. |
| `docs/openapi.json` | Complete method-level contract for the runnable root application. |
| `examples/full-workflow.mjs` | Real HTTP end-to-end example using an isolated in-memory database. |
| `examples/api.http` | Manual HTTP requests with login and version handling. |
| `tests/` | 43 automated unit/integration/operations tests. |
| `original-neon-backend/` | All 242 files from the originally uploaded repository, byte-preserved. |
| `docs/ORIGINAL-SOURCE-MANIFEST.json` | Exact original file paths, sizes and SHA-256 hashes. |
| `docs/VERIFICATION.md` | Fresh test results and what remains unverified. |

## Demo accounts

All four public local-demo accounts use password **`Demo@12345`**.

| Account | Role |
| --- | --- |
| `admin@carbonsynq.demo` | Administrator |
| `entry@carbonsynq.demo` | Data entry |
| `reviewer@carbonsynq.demo` | Reviewer |
| `ceo@carbonsynq.demo` | Leadership/read-only |

These are not production credentials. The creator cannot verify their own activity. Switch to the reviewer account for approval.

## Working flow

Manual entry -> DRAFT -> submit -> separate reviewer starts review -> verify -> calculate -> dashboard/report.

Invoice upload -> preserve original evidence -> text suggestions or manual fields -> confirm consumption -> linked DRAFT -> same reviewer workflow.

Invoice amount in INR is never substituted for kWh/litres/kg. Scans can be uploaded and entered manually; no AI OCR is connected. Factors and university records are visibly synthetic/illustrative.

## Test and see a full API journey

```sh
npm test
npm run demo:flow
```

`demo:flow` starts its own ephemeral loopback HTTP server with an in-memory database, performs login/manual entry/invoice upload/review/calculation/report checks, then exits. It does not change `.local-data` or contact Neon. The fixture explicitly confirms known synthetic invoice values; it is not an automated approval mechanism for real invoices.

## Data, backup and reset

Normal startup stores data in `.local-data/demo.sqlite`, including original invoice bytes. Stop the server with Ctrl+C before backup or reset:

```sh
npm run backup
npm run reset -- --confirm-local-demo-reset
```

Reset preserves the previous data folder; it does not silently delete it. Keep the database and backups private.

Default port is 5050. On Windows PowerShell, change it with:

```powershell
$env:DEMO_PORT = "5051"
npm start
```

The implementation reads real environment variables; it does not load a `.env` file. `DEMO_DATA_DIR` overrides the demo data directory. `NODE_ENV=production` deliberately refuses startup.

## Original Neon project

`original-neon-backend/` retains your original `src/`, migrations, datasets, package/lock files and documentation. None of those source files were modified for this delivery. Its TypeScript build, original tests, dependencies and remote database have **not** been validated in this delivery. No original database was contacted or migrated. See HLD section 10 before adapting the original invoice path or exposing its routes.

## Important

This is complete source for the delivered **demo scope**, not a certified production carbon-accounting platform. Production OCR, SSO, approved emissions factors, Scope 3, cloud storage, malware scanning, load testing and integration with the original Neon service remain implementation work. Do not expose public demo credentials on the internet or use real university invoices without a security/privacy review.

Native Windows/macOS launcher execution and a native browser-to-localhost session were not verified here. Rehearse on the presentation laptop.
