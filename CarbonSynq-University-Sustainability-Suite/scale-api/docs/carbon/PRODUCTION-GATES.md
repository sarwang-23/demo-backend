# Production acceptance gates - no automatic green status

Owner approval and dated evidence must be recorded for every applicable gate. Unit-test success is not infrastructure acceptance. Do not expose this local Compose stack publicly as-is.

| Gate | Minimum evidence required |
| --- | --- |
| Database upgrade | Restore a realistic staging database, apply unchanged001/002 plus003, inspect view column types/permissions, verify existing totals, execute core/university/carbon PostgreSQL acceptance suites. |
| Tenant and role isolation | Real non-owner API role, FORCE RLS, cross-tenant ID fuzzing for every new resource, worker denial of operational tables, no public owner credentials. Test failed transactions and pooled connection tenant-setting cleanup. |
| Concurrent writes | Two independent API instances: legacy insert versus activation, same source intervals, competing certificate allocations, repeated approval, repeated idempotency key, correction release. Assert one consistent ledger and no oversubscription. |
| Period/report integrity | Incomplete source dates and high findings block lock; resolved readiness permits snapshot; reopen invalidates currentness, not snapshot history; factor/boundary/calculation tampering denied to ordinary role. |
| Evidence ingestion | Real private versioned bucket, deny anonymous access, quarantine-to-clean lifecycle, malicious/oversized/parser-bomb tests, real scanner signature update/failure, pinned-version download hash, tenant quotas. |
| Identity and transport | University-approved SSO/MFA or documented interim controls, account recovery/offboarding, secure session transport, TLS/reverse proxy trust, secrets manager, no fixture accounts or test-only server reachable. |
| Native browser | Real Chrome/Edge/mobile navigation against real infrastructure; login, source creation, JSON editor validation, manual/invoice evidence, maker-checker, error states, CSP, downloads and accessibility. DOM bridge QA is not this gate. |
| Accounting methods | Qualified approval of source hierarchy, control boundary, all-gas fuel factors, GWP basis, refrigerant mass boundaries, purchased-energy units, thermal generation factors, energy attribute eligibility and residual fallback. |
| Completeness | Physical register reconciliation, campus exclusions reviewed, no main/submeter duplication, zero/no-activity evidence, period overlap policy, approved action closure. |
| Privacy | Minimum needed evidence, personal data redaction, campus/department role policy, retention/legal-hold process, export access review and incident process. |
| Backup/restore | Timed PostgreSQL restore AND recovery of referenced object versions, key/secret recovery, report/calculation reconciliation. Set measured RPO/RTO; do not assume a DB dump includes invoice bytes. |
| Capacity | Representative university source and evidence volumes, API latency p95/p99, concurrent tenants, pool limits, lock wait, report snapshot memory, upload/storage quotas, worker retry/dead-letter tests. Current 200-source/5,000-record bounds must be respected. |
| Supply chain | Resolve real package/image availability; pin approved image digests, scan dependencies and licenses, produce reproducible lockfile/SBOM in a connected build, remove unsupported components if necessary. |
| Standards changes | Review applicable current reporting requirements and factor years. Do not silently adopt proposed standards or present internal reports as external compliance certifications. |
| Sign-off | Institution data owner, accounting reviewer and security/operations owner sign the reconciled pilot result before scaling to more campuses. |

Not yet connected in this release: SSO/MFA, OCR provider, ERP/IoT, registry or official factor feed, notification delivery and billing. No verified user/concurrency limit or SLA is supplied. Record actual results rather than marking a gate passed because a checklist file exists.
