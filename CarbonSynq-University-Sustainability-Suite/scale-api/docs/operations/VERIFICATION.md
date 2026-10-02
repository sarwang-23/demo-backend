# Operations upgrade - measured verification

Release `2.4.0-operations-rc.1` | 2026-10-02

## Executed in the delivery environment

| Check | Result | Evidence / limitation |
|---|---|---|
| Integrated scale-api automated tests | **531 passed, 0 failed, 0 skipped** | 413 previous tests + 118 new operations tests. Domain memory stores and SQL/network doubles are explicitly labelled; not real PostgreSQL/S3. |
| Original root SQLite demo | **43 passed, 0 failed** | Regression coverage for the preserved separate demo, not proof of the scale stack. |
| Operations HTTP/contract checks | Included in the 531 | Real local Node HTTP requests, actual middleware/static assets, staff/public routes and API-role documentation; account/persistence services use fixture adapters. |
| JavaScript syntax / university route contract | **110 files checked; 151 existing university operations covered** | New operations contract separately checks all 28 staff routes plus 2 public account operations. Migration versions 001-005 discovered; SQL was NOT executed. |
| New UI workflow | **17 checks passed; no application JS errors** | Chromium DOM plus explicit actual local-HTTP bridge, with synthetic authentication/data/storage/scanner metadata. Native localhost navigation was blocked by environment policy. |
| Actual English OCR | **One image-only synthetic PDF passed** | Tesseract 5.5.0; one page, 30 words; original hash unchanged. About 1.1 seconds in this one fixture. Not an accuracy/throughput benchmark. |
| Backup integrity | Real temporary-file tests passed within the 531 | Exact object version requested; size/hash/mode verification; incomplete/tampered/path-traversal/symlink rejection. Synthetic dump bytes, not pg_dump or restore. |
| Background inventory serializer | **6,001 rows processed with exact 600.100000 kg total** | Synthetic 0.100000-kg rows, paged encoder; worker DB/S3 behavior uses adapters, not a measured live 6,001-row query. |
| Compose syntax | Parsed as YAML; tmpfs entries checked | Not a Docker/Compose startup test. |
| Full integrated source book | **149 complete files with SHA-256 manifest** | Source, configuration, contracts and tests; excludes private data, installed dependencies, binary samples and historical source copies. |

Test evidence is in `verification/`. `ocr-verification.json` records the separate real OCR smoke. Standard tests do not repeatedly run OCR. UI screenshots carry a synthetic-fixture label. `PACKAGE-CHECK.json` records testing after final archive extraction; use it with the preservation manifest for delivered-file integrity.

## Attempts that did not establish success

Native Chromium navigation to the loopback service returned `ERR_BLOCKED_BY_ADMINISTRATOR`. The fallback DOM/HTTP harness validates UI behavior but does not prove native navigation, CSP execution, TLS or browser-security integration. HTTP tests confirm headers exist, not that all browser enforcement passed.

A registry-enabled dependency-lock attempt was made with bounded timeout and no install scripts. It failed with `EAI_AGAIN` resolving registry.npmjs.org. No fabricated lockfile or installed dependency audit is included. The existing direct dependencies were not silently changed.

Docker, PostgreSQL/psql and pg_dump were unavailable. Real migrations, forced RLS, concurrent SQL locks/triggers, object versioning, ClamAV scanning/signatures, mail webhook delivery, pg_dump/object backup round trip, restoration, hosted CI, load and penetration tests were not executed. The supplied acceptance scripts and CI workflow are authored code, not passing hosted results.

## Features intentionally not described as completed

SSO/MFA; every-role/every-entity department ABAC; arbitrary-layout spreadsheet understanding; reliable handwriting or multilingual OCR; automatic deletion/redaction/retention compliance; full narrative-report scaling; export orphan cleanup; real email-provider/bounce integration; production infrastructure acceptance and a verified concurrent-user capacity. The institution still supplies approved factors, boundaries, role policy and report sign-off.

This is a release candidate with implemented application features, not a universal university ERP, regulatory certification or production readiness verdict.
