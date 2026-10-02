# Migration and compatibility plan

## What this ZIP does and does not change

All 295 files from the submitted package are retained byte-for-byte at their original relative paths. Additions are `scale-api/`, the two START-SCALE launchers, the scale README, the preservation report and a separate CI workflow. The earlier demo still starts with root `npm start` on its original port. No original database is opened, migrated or deleted by the additive source packaging.

The new schema name is `cs`. It does not collide with or alter the original public ORM tables by design. Its migrator does create runtime roles if they are missing, so an operator must first test it against an appropriate staging database. Separate database/project deployment is preferred for initial evaluation.

## Three independent code paths

| Existing root demo | Original Neon code | New scale foundation |
| --- | --- | --- |
| Native Node HTTP + SQLite | Original Express/TypeScript/Drizzle/Neon repository | Native Node HTTP + pg/PostgreSQL/S3/worker |
| `/api/v1` | Original contracts | `/api/v2` |
| Synthetic seeded data/factors | Original behavior unchanged | Empty tenant, no factors/activities seeded |
| Known local rehearsal tests | Original dependencies/build not verified here | New offline tests; infrastructure integration still open |

No route alias silently maps v1 writes to v2. No legacy JWT is accepted as a new opaque session token. No importer trusts original mock OCR output or invoice rupees as consumption.

## Staged migration sequence

1. Inventory the original endpoints, clients, entity IDs, units, statuses, emission-factor assumptions and evidence references. Freeze a source snapshot with counts and hashes; keep the existing app unchanged while validating.
2. Define the target customer scope and exact contract mappings. The new request DTOs use camelCase and numeric strings; database rows return snake_case. Decide whether to update clients or implement an explicit compatibility adapter with tests.
3. Provision a separate staging database/tenant and run the v2 migrations. Import hierarchy, users with a secure credential-transition plan, approved factor versions and only validated activity/evidence records.
4. Treat old calculations as historical source facts requiring reconciliation, not as automatically re-approved v2 calculations. Preserve source IDs in an explicit mapping ledger before building the importer. A mapping/importer is not included here.
5. Re-upload historical original files to private versioned storage, scan and verify bytes, then link records using durable ID mappings. Do not substitute previews, mock OCR or a filename-only reference for original evidence.
6. Compare per-period/campus/category counts, quantity totals by unit, calculated emissions and evidence hashes. Differences must be explained and approved. Do not sum incompatible consumption units.
7. Test permissions and every frontend flow, then choose a cutover window, make final backups, freeze old writes, import the delta and reconcile again. Switch traffic only after acceptance. Retain a read-only old service as required by the retention plan.

A rollback is not simply pointing the old app at the new database. Once v2 accepts new writes, define how those records can be reconciled or replayed safely if traffic is switched back. Do not promise transparent rollback without a tested data plan.

## Deliberately excluded from this delivery

Automated legacy import, dual-write synchronization, client contract compatibility, upgrading the old ORM, replacing old secrets, changing a deployed Neon instance, fixing every old controller, and providing a complete university ERP. The original code is preserved for continued work; its previous security/accounting limitations are not erased by this additive folder.
