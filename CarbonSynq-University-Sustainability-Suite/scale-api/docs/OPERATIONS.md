# Operations and deployment runbook

## 1. Local stack versus a live service

`compose.yaml` publishes the API, database, scanner and object-store ports **on loopback only**. Keep it local. It is not a production template to expose with public ports. It has no managed HA, external secret service, CDN/WAF, scheduled backup or alert routing.

The local S3 fixture is built from the MinIO security release `RELEASE.2025-10-15T17-29-55Z`. It is a development fixture, not a production recommendation. Upstream MinIO community server releases/archive status should be reviewed before use; the source-build step intentionally avoids silently choosing a pre-fix image. The build was not executed here. Production guidance in this project targets managed private AWS S3 with versioning/public-access-block/encryption controls.

Start in `scale-api/` with `npm run setup` then `docker compose up --build -d`. Preserve the generated `.env` securely; regenerating database passwords while reusing old Docker volumes will not rotate existing PostgreSQL roles. Never commit `.env`. Do not run destructive volume resets against customer data.

```bash
docker compose ps
docker compose logs --tail=100 api worker scanner migrate storage-init
docker compose run --rm migrate node scripts/provision.mjs
```

Provision custom local identities with explicit environment values passed to the **migrate** service, not the API container:

```bash
docker compose run --rm -e TENANT_NAME="Your University" -e ADMIN_EMAIL=admin@your-domain.example -e REVIEWER_EMAIL=reviewer@your-domain.example migrate node scripts/provision.mjs
```

Passwords are generated and printed once when not supplied. Send them through an approved private channel. Both users should call the password-change endpoint after sign-in; an email invitation/recovery service is not part of this release.

## 2. Managed staging / production process separation

Install dependencies in a controlled build. Create/review/commit `package-lock.json`, switch Docker/CI to `npm ci`, audit dependencies and pin container/action digests before a release. The dependency versions in package.json are explicit, but transitive dependencies are not reproducibly locked by this delivery. No fake lockfile was generated while npm registry access was unavailable.

Use three environment-specific credentials:

| Process | Database role and secrets |
| --- | --- |
| Migration / provisioning job | `DATABASE_OWNER_URL`, role-creation passwords; never mounted in API/worker |
| API | `DATABASE_URL` for `cs_api`, S3 workload identity, METRICS_TOKEN, shared REQUEST_HASH_SECRET |
| Worker | `WORKER_DATABASE_URL` for `cs_worker`, S3 workload identity, private scanner connection |

The example `.env.example` lists all settings for operator reference. Do not copy the complete operator environment into every production process. Use separate secret sets and workload identities. The Compose runtime environment separates database roles, but local S3 fixture credentials are deliberately broad for development only.

Use a direct/session-capable PostgreSQL connection for migrations and test transaction behavior with any provider pooler. `pg` is used, not the old Neon HTTP query helper. Enable `DB_SSL=true`, verify certificates, and use `DB_CA_FILE` where the provider requires a private CA. Remove ambiguous `sslmode`/certificate URL query parameters from application URLs.

Deploy only the new API behind TLS. Set exact HTTPS `ALLOWED_ORIGINS`. Restrict incoming traffic to the load balancer; do not trust arbitrary X-Forwarded-For headers. Leave TRUST_PROXY=false unless the trusted proxy overwrites this header and all direct paths are blocked. The Nginx example overwrites, not appends, the client-supplied value. Review timeouts and hostname routing for your environment.

## 3. S3 and evidence policy

Create a private bucket, enable versioning, all four Block Public Access options and encryption. The production startup guard checks these settings. Configure least-privilege IAM for bucket configuration reads and object Put/Get/GetObjectVersion/Head access to the evidence prefix. Prefer workload identity. Customer browsers never receive bucket credentials or direct public URLs.

The source records VersionId and SHA-256 and never serves quarantined evidence. Versioning is not Object Lock. Storage administrators with sufficient permissions can still remove a version. Apply Object Lock/legal hold only after retention requirements and operations have been designed. If using KMS, include the corresponding KMS permissions and verify recovery access.

No runtime object-deletion capability or purge daemon is included. Plan lifecycle rules carefully: deleting a pinned noncurrent version can break an audit trail. Logical tenant quota is not a cloud-billing estimate; extra versions/orphans also consume bytes. Add an inventory-based reconciliation and governed retention process before public upload traffic grows.

A read-only integrity scan is included:

```bash
# Supply CHECK_TENANT_ID plus the API's database/S3 settings in the operator environment.
npm run storage:check
```

It reads pinned versions and verifies byte length/digest. It does not delete, repair or certify all storage; missing/failed reads produce a nonzero exit code. Use a controlled maintenance identity and an off-peak plan for large evidence sets.

## 4. Worker / malware operations

The scanner TCP port is unauthenticated; never expose it publicly. The local stack binds it to 127.0.0.1 for developer diagnostics. In production, restrict it to worker identities/private subnets. Keep signatures fresh, alert on signature age and run a harmless approved antivirus test file through the real upload path in staging.

A failed scan does not fall back to acceptance. Jobs retry with backoff up to max attempts, then DEAD. Fix the dependency before an administrator calls `/api/v2/jobs/{id}/retry` with a useful reason. An INFECTED document remains rejected, not approved through a retry button. False-positive release needs a separate reviewed process, not scanner bypass.

Worker polling defaults to 1 second, leases to 180 seconds, scan timeout to 45 seconds. External S3 reads and parser extraction are bounded separately. Tune lease/timeout/shutdown settings together; a lease that expires before expected work permits duplicate execution, which still relies on fencing and idempotency. Restrict container CPU/memory and egress. Node worker threads are not security sandboxes.

`docker compose up -d --scale worker=2 worker` can request more local worker containers after prerequisites are healthy. This is a configuration path, not a verified benchmark. Do not use `--scale api=2` with the supplied fixed localhost port; production API replicas require internal addressing and a real load balancer.

## 5. Pool budgets and observability

Plan the sum of every API/worker pool plus migrations, monitoring and administrative headroom. More replicas with unchanged pools can exhaust PostgreSQL connections. Start with the configured cap of 10 per process only as an initial setting, not a recommended capacity guarantee. Measure transactions, lock waits, idle connections, query plans and autovacuum behavior.

Use `/healthz` for process liveness and `/readyz` for recent dependency readiness. A green heartbeat is not end-to-end correctness. Prometheus metrics need `Authorization: Bearer <METRICS_TOKEN>` and should stay on a private scrape path. Logs are structured JSON and omit request bodies and credentials.

Alert on: sustained 5xx/429; query timeouts and pool saturation; oldest available job age; retry/DEAD counts; stale worker heartbeat; scanner signature age/failure; UPLOADING past deadline; quota exhaustion; S3 integrity failures; backup age and restore failures. A complete Prometheus/Grafana/alert-manager installation is not included.

Audit/ledger immutability is protected from normal application writes, not privileged database tampering. For stronger assurance, export audit events to independent immutable storage and design cryptographic verification. That integration is not implemented here.

## 6. Backup and restoration

Enable managed database point-in-time recovery and keep independently protected backups. Evidence bytes are in S3 and require their own retained versions, encryption keys and recovery access. A PostgreSQL dump alone is not the entire product backup.

`npm run backup` invokes installed `pg_dump` through a dedicated `BACKUP_DATABASE_URL`. It creates a mode-600 custom dump of the cs schema, without embedded ownership/ACL restoration. It requires a role that can read all tenants under RLS. A tenant-limited API credential is not a cross-tenant backup identity. The script does not encrypt output; encrypt and control it before moving it off-host. It has not been executed against a real database here.

For a restore drill, create a new isolated database and separate private object bucket/access policy. Restore the full schema/data into that empty database with an authorized operator, recreate runtime roles and the reviewed grants from the migration, verify RLS/constraints/triggers, and ensure all referenced object versions and keys are available. Do not restore over the active customer database as a test. Do not rerun initial schema creation into a database already restored with those tables.

Then run tenant isolation checks, ledger/aggregate reconciliation, read-only evidence integrity checks, job recovery and user acceptance. Record RPO/RTO from this drill; neither objective is measured in the delivered environment. Retain old credentials/keys only as governed by the recovery/security plan.

## 7. Rollout and failure handling

Back up before applying migrations. Migration 001 creates a new schema and checks its checksum; it does not import legacy records. Run the migrator as a one-off job and stop on failure. Never change an applied migration to make a checksum error disappear. Future schema evolution needs numbered migrations, compatibility and rollback/reconciliation design.

For API rollout, stop new traffic to a draining instance, wait for in-flight requests, then terminate within the configured grace period. For worker rollout, allow in-flight work to complete; unexpected termination is recovered after its lease. Keep shared HMAC secret stable across replicas and releases during the idempotency window.

After a database/network timeout, reconcile before assuming failure. Use the original create key/body; for workflow actions fetch the current version/state. For S3 uncertainty, wait for upload reconciliation and inspect the existing document. Do not upload the same bill under a new key solely because the browser timed out.

Stopping local containers with `docker compose stop` preserves volumes. Backup before changing anything that removes volumes. There is deliberately no one-click destructive product reset.

## 8. Read-only smoke measurements

The opt-in `npm run load:smoke` reads activity pages only, defaults to 100 requests/4 concurrent calls, and caps the request count. It requires BASE_URL, ACCESS_TOKEN and CONFIRM_STAGING_LOAD=yes. Use only an environment you own and authorize. It prints latency percentiles/statuses, fails on non-200 results, and explicitly is not a throughput or capacity certification.

A real release test must include mixed tenants, concurrent writes and review, large uploads, scanner backlog, worker crashes, key retries, query plans, realistic data volume and infrastructure faults. No such load benchmark was run in this delivery.
