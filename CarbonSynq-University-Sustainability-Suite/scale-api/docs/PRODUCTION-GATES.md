# Production acceptance gates

**Current decision: source foundation delivered; public production acceptance remains OPEN.**

This checklist separates implemented code from environmental and product work. A checkbox is evidence only when a named owner attaches the actual result; the presence of a test script is not a passing test.

| Gate | Required evidence | Delivery status |
| --- | --- | --- |
| Original files preserved | SHA-256 path/content comparison | Checked in preservation manifest |
| Existing demo regression | Root 43 tests | Passed separately |
| New offline tests | Validation/HTTP/adapter suite | 94 passed |
| Local console render | Desktop/mobile fixture interactions | 11 checks passed; mocked API, no network deployment validation |
| Real PostgreSQL execution | Migrations, RLS, rollback, concurrency, unique ledger and quota tests on a fresh database | Authored integration suite; not run here |
| Real object storage | Correct IAM, public access denied, version pinning/digest, retries and missing versions | Not run |
| Real malware path | Harmless scan fixture, approved antivirus test, encrypted/over-limit files, stale signatures/failure | ClamD client socket-fixture tested; live engine not run |
| Runtime containers | Build images, health checks, provisioning, persistent restart and network rules | Docker unavailable here; not run |
| Dependency supply chain | Reviewed lockfile, `npm ci`, audit, SBOM, image/action digests and license review | Exact direct versions specified; lock/build/audit not run |
| Authorization security | Cross-tenant matrix, user access changes, last-admin policy, hostile inputs and pen test | Offline guards tested; independent/staging review still open |
| Recovery | DB/S3 version backups and documented successful restore/RPO/RTO | Scripts/runbook supplied; drill not run |
| Resilience | Kill API/worker during upload, commit and calculation; replay keys; reconcile totals | Test design supplied; live fault injection not run |
| Performance | Agreed dataset, hardware, traffic mix, p95/p99/error/queue-age targets | No measured capacity claim |
| Accounting acceptance | Approved methodology/factors, boundaries, dates, reviewer policy and correction rules | No official factors seeded; customer approval needed |
| Operations | TLS, secrets, workload identity, dashboards/alerts, quotas/retention, incident process | Source hooks/runbook supplied; deployment integration open |
| Original frontend/data migration | DTO mapping, staged import, reconciled balances/evidence, controlled cutover | Not implemented |

## Product work to decide explicitly

University SSO/MFA, invitations/password recovery, user lifecycle and permission granularity; Scope 3 and advanced Scope 2; multi-line invoices/split allocations; multiple evidence documents; correction/reversal ledger; factor publishing/review provenance; tenant onboarding/offboarding, billing and subscriptions; legal retention and consent; automated archive/orphan cleanup; signed audit evidence; multi-zone/multi-region operation.

Do not add placeholder endpoints returning fabricated success for these features. Prioritize based on signed customer scope and keep them out of an unsupported live claim.

## Minimum staging acceptance scenario

Create two independent tenants with different admins/entry/reviewers. Attempt all cross-tenant reads and writes. Create a genuine manual record and matching invoice entry; reject self-approval and stale versions. Approve a real appropriate factor. Run with at least two API processes and two workers. Race duplicate create keys, uploads and worker lease expiration. Confirm one calculation and matching ledger/monthly totals.

Kill processes around S3 PUT, database commit and job finalization. Recover, reconcile and confirm no silent evidence loss or double counting. Introduce scanner failure and an approved antivirus test; verify quarantined files never download or create accepted activity records. Restore a backup into isolation and verify its referenced object versions.

Measure the traffic target on representative records/files, record results and run an independent security review. Only then sign a customer pilot/public-release acceptance appropriate to the remaining product scope.
