# Delivery change log

## Added

- `university-demo/`: zero-external-dependency local Node/SQLite backend and browser UI.
- Authenticated tenant-scoped consumption and document APIs, reviewer workflow and factor snapshots.
- Local university seed, four role accounts and original synthetic invoice fixtures.
- Dashboard, invoice review form, activity ledger, review queue, CSV/JSON reports and audit UI.
- Unit/integration tests, OpenAPI reference, HLD, demo runbook and operations tools.
- Root Windows/POSIX launch scripts and this delivery's README.

## Modified in original project root

- `package.json`: added `demo`, `demo:test`, `demo:backup`, `demo:reset` convenience scripts only.
- `.gitignore`: ignore new local demo databases/backups.
- `README.md`: filled previously empty README with the delivery guide.

## Deliberately not modified

Original `src/`, Drizzle migrations, original tests, original dependency versions, original lock files and original application entry point. No existing remote database, account or deployment was accessed or mutated. The new demo schema does not migrate or import original data.

## Not included

Live deployment, real university credentials/data, an API key, production OCR, official emission factors, Scope 3 accounting, SSO or a production security guarantee. See HLD for the integration path.
