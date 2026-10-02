# Production acceptance gates - not completed by this delivery

| Gate | Acceptance evidence needed |
|---|---|
| Dependencies and images | Generate/review lockfile; use npm ci; audit runtime transitive dependencies; pin and scan release image digests; verify licenses |
| Migration | Apply 001 -> 002 to isolated copy; verify history/checksums, constraints, views, permissions and failure recovery; no owner runtime credentials |
| PostgreSQL tests | Pass original and university integration suites on PostgreSQL 17; RLS/cross-tenant insert tests; real concurrent retries/approvals/period locking; trigger immutability |
| Evidence | Real private S3-compatible versioning, checksums/downloads, quarantine, scanner failure/EICAR test in controlled environment, signature freshness and restore of object versions |
| Browser | Native desktop/mobile navigation, real sessions, role switching, uploads, all lifecycle forms, downloads, production CSP/origin policy and accessibility assessment |
| Data governance | Institution-approved boundary, factor geography/year/methodology, Scope 3 applicability, student classification, supplier evidence and report sign-off |
| Authorization | Review old core tenant-wide permissions; implement campus/department ABAC or delegated roles before promising scoped departmental access; provision real separate reviewers |
| Identity and privacy | SSO/MFA or approved alternative; secure credential recovery; retention/deletion policy; minimum-necessary personal data; supplier/survey consent and sharing controls |
| Scale | Representative data-volume/concurrency benchmarks, connection budgets across replicas, overload/rate limits, tenant row quotas, 5000-row snapshot boundary and asynchronous reporting design |
| Recovery and operation | Coordinated PostgreSQL+object backup, measured restore drill, reconciliation, tracing/metrics alerting, incidents and credential rotation |
| Product integrations | Real ERP/IoT/service-account integration, email/reminders or OCR only after implementing providers, authentication, replay controls, limits and separate acceptance tests |
| Accounting exclusions | Scope 3 categories 9-15 calculators, market-based Scope 2, offsets, avoided-emissions claims, verified project attribution or complete PCF need separate governed implementations |

Do not label this release production-certified, legally compliant, independently assured, net-zero verified or proven at a stated user count. The local Compose stack is for isolated integration and rehearsal. An approved report is an internally reviewed software snapshot, not independent assurance.
