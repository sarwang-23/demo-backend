# Safe upgrade and rollback

## Source preservation

Every file from the input ZIP is represented in this delivery. Unmodified originals remain at their original relative paths. The small number of changed integration/UI/build files have their previous bytes at `upgrade-backup/scale-v2/<original path>`. `upgrade-backup/input-manifest.json` records SHA-256 hashes. The final preservation report lists exactly what changed. No original migration, SQLite implementation or original Neon source file was replaced.

## Database upgrade sequence

1. Confirm that this is the existing **scale-api PostgreSQL schema** (`cs.schema_migrations`, version 001). This migration does not apply to the root SQLite file or the original Neon/Drizzle schema.
2. Back up PostgreSQL and every referenced private object version; perform a restoration drill in isolation. A database-only backup cannot recreate missing evidence objects.
3. Retain the existing `.env`, role passwords, named volumes and bucket. Do not run `docker compose down -v`, reset scripts or provisioning against an existing tenant.
4. Stop API and worker during the schema upgrade. From `scale-api/`:

```bash
docker compose stop api worker
docker compose build api worker migrate
docker compose run --rm migrate
```

5. Confirm migration history now has unchanged 001 and new 002. The migration runner checks checksums and takes an advisory lock. Each new SQL migration is committed atomically. If validation or execution fails, do not restart the new application until investigated.
6. Start the services and verify readiness and evidence jobs:

```bash
docker compose up -d api worker
docker compose ps
docker compose logs --tail=100 api worker
```

7. Existing tenants use their existing accounts. Install KPI definitions separately per university, register applicable factor versions and independently approve them. Test one full collection, invoice and report cycle before opening access.

Existing original core `/api/v2` Scope 1/2 routes remain. `/api/v2/university/*` adds new resources. The **core dashboard itself still reports core records only**; the new university overview/reporting view combines both ledgers. This avoids silently changing the old dashboard contract.

## Rollback is an operational decision, not a destructive command

No down migration drops the new university tables. Rolling back only application code can leave university records invisible to the old application and remove the new period-closing protections. Do not run the old application as an active writer after new university data exists without a reviewed compatibility plan. Prefer a forward fix. Restore the coordinated database/object backups only under an approved recovery procedure, with documented loss of writes since backup.

## Migrations and secrets

Use a dedicated owner credential only for provisioning/migrations. Runtime APIs use `cs_api`, worker uses `cs_worker`. Do not connect the API as owner, superuser or BYPASSRLS. FORCE RLS is not a defence against a privileged operator deliberately changing database security. No database performance or RLS behaviour is considered verified until the real PostgreSQL suite runs in your environment.

PostgreSQL reference: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
