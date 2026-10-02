# Coordinated backup and evidence retention

The new backup tooling is operator-only. It is not a browser download endpoint and never automatically deletes or restores anything. It has been tested with real local fixture files/checksums, not against an actual PostgreSQL/S3 deployment.

## Source backup prerequisites

Use a compatible pg_dump executable and the installed `pg`/S3 runtime dependencies. Set BACKUP_DATABASE_URL to a dedicated approved all-tenant backup identity; an RLS-limited application role would silently omit data and is rejected. Configure the same verified S3 endpoint/bucket identity and database TLS/CA settings as the source, with read-only rights to every referenced version. A production RLS-bypass backup identity and infrastructure keys must not be shared with the web application.

Set BACKUP_CONFIRM=all-tenants-readonly, BACKUP_DIRECTORY to a protected destination and, when necessary, BACKUP_MAX_BYTES (default 10 GiB object bytes). Then run:

```bash
npm run backup:bundle
npm run backup:verify -- /absolute/path/to/the-created.backup-bundle
```

One exported PostgreSQL snapshot is used for the schema dump and object references. Exact stored versions are copied after pg_dump completes. The bundle contains `database.dump`, `objects/00000000.bin`-style original files and a manifest of version IDs/hashes/sizes. Only a fully copied bundle gets `complete:true`. Limits: 50,000 referenced objects, up to 32 MiB per object, configurable total source-object bytes. A failed/incomplete directory must not be treated as a successful backup.

The verifier detects missing/tampered files, invalid paths, symlinks and incomplete manifests. It does not decrypt, malware-scan, restore or certify recoverability. Protect the bundle with external encryption and least-privilege filesystem/storage permissions. Backed-up quarantined originals remain quarantined data; do not open or execute `.bin` files.

## Restore is a separate release gate

Restore into an isolated environment first. Recreate reviewed roles/privileges; the dump is generated with no-owner/no-acl. Validate schema migration checksums and tenant RLS. Reconcile exact referenced object versions and independently approved exports against their hashes.

Uploading bytes into a new S3-compatible store normally assigns new version IDs. Do not claim that a generic object re-upload completes recovery. Use provider-native version-preserving recovery, or design/review a full remapping of every database and immutable snapshot version reference. This ZIP does not perform that destructive migration. No restore drill, RPO or RTO is claimed.

Only database-referenced document/export versions are captured. Orphaned upload attempts, nonreferenced version history, external email captures, environment secrets and infrastructure configuration need their own approved recovery procedures. Keep encryption keys separately recoverable; otherwise encrypted pending mail cannot be read after restoration.

## Holds and deletion

Operations lets administrators record indefinite or time-limited preservation holds, release them with a reason, and inspect known current references. Original bytes remain preserved. The dependency list is a review aid, not automatic proof that deletion is lawful or safe; approved calculation/report snapshots can retain provenance.

There is no automated retention deletion, redaction, right-to-erasure compliance workflow or deletion override. Full narrative report generation and export orphan cleanup are also not silently added. Define institutional retention, approved legal holds, artifact lifecycle and privacy requirements before implementing deletion.
