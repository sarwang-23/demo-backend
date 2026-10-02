# Import release - measured verification

Release 2.3.0-ingestion-rc.1 | 2026-10-02

## Executed locally

| Check | Measured result | Boundary |
|---|---|---|
| Integrated Node tests | **413 passed, 0 failed, 0 skipped** | Pure, HTTP, memory-domain, adapters and actual Python/Poppler parser tests; not real PostgreSQL/S3 |
| New ingestion tests | **120 passed** within the 413 | 58 normalization, 36 domain, 19 parser and 7 HTTP |
| Prior SQLite demo | **43 passed, 0 failed** | Root legacy demo regression |
| Workbench UI | **13 passed; no JS errors** | Chromium DOM harness plus actual local HTTP bridge; synthetic DB/storage/scanner |
| Syntax/API | **80 JavaScript source/config/test files checked; 151 staff operations documented** | 17 new intake operations plus existing 134; 2 external portal operations separate |
| Migrations | Versions 1,2,3,4 discovered; checksums retained | Migration execution against PostgreSQL NOT performed |
| Local actual-file example | 5 spreadsheet candidate rows (2 visibly skipped); 6 invoice groups | 0 database writes |
| Sample visual QA | 3 input workbook sheets, 2 normalized-export sheets rendered; PDF pages inspected | Synthetic sample data only |
| Original files | **483 paths retained: 465 unchanged, 18 updated with exact backup** | SHA-256 comparison against uploaded ZIP |
| Full-code document | **110 full source/contract/config files** | CODE-MANIFEST.json contains exact hashes |

The 413 tests include actual binary XLSX/CSV/PDF parser execution, bounded OOXML package rejection, no formula execution, date/number locale errors, exact MWh conversion, missing quantity, duplicate and overlap blocking, preserved originals/provenance, owner/tenant checks, stale versions, period/factor rechecks, atomic rollback in the test store, six invoice drafts and existing independent approval semantics. Passing a memory transaction test is not evidence that PostgreSQL locks/constraints were executed.

The UI test uploaded actual messy XLSX bytes and six actual PDFs to the local HTTP fixture, used the real parser, staged/reviewed data through the real domain services, created three draft records and downloaded actual XLSX bytes. Its document store and antivirus metadata were synthetic. Native localhost browser navigation was blocked by the execution environment; an explicit DOM harness was used instead. No claim is made that native navigation, CSP, TLS, browser security integration or external providers passed. Screenshots are labelled synthetic and focus on the workbench.

## Not executed / still required

Real PostgreSQL/RLS/migration/locking, real private S3, real ClamAV scanning and signatures, Docker build/Compose startup, dependency registry install/audit, load or penetration testing, native Windows launcher and native browser/CSP. The PostgreSQL acceptance script and CI workflow are included but not marked passed.

PDF scans have no OCR in this build. ERP/IoT sync, SSO/MFA and automatic certified reporting are not implemented by this release. Official factor governance remains university-configured. This is a release candidate with runnable source, not a production or regulatory certification.

See backend-tests.tap, legacy-tests.tap, ui-results.json, syntax-check.txt and PRODUCTION-GATES.md for reproducible checks and boundaries. Final extraction verification is recorded separately in PACKAGE-CHECK.json.
