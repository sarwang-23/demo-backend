> Historical release reference (university v2.1). The current Scope 1/2 upgrade is documented in `../carbon/HLD.md`; its added methods and verification supersede earlier feature-limit statements. Original version is retained in `upgrade-backup/university-v2.1/`.

# University Sustainability Suite - verification and release boundary

**Version:** 2.1.0-university-rc.1  
**Delivery date:** 2026-10-02  
**Status:** integrated source-code release candidate, not a production-verified service.

## Results actually obtained

| Check | Actual result | What it proves / does not prove |
|---|---|---|
| Existing scale foundation tests | 94 passed | Existing dependency-free unit/HTTP/adapter cases still pass. |
| New university tests | 111 passed | Validation, exact arithmetic, workflows, permissions, API boundaries, repository query contracts and test-double transactions. |
| Combined scale-api command `npm test` | **205 passed; 0 failed; 0 skipped** | Executed on Node.js 22.16.0. This is not a live PostgreSQL/S3/ClamAV test. |
| Original root SQLite demonstration | **43 passed; 0 failed; 0 skipped** | Regression test suite executed; original demo implementation was not modified. |
| Syntax / route contract check | **51 source files checked; 85 authenticated university operations covered** | Node syntax checks and contract coverage passed. Two additional capability portal operations bring the new total to 87. No SQL execution is implied. |
| Browser UI checks | **14 passed** | Real Chromium DOM and interaction checks against an explicitly synthetic in-memory fixture through the actual local HTTP/domain handlers. Desktop 1440 px and mobile 390 px. |
| Source preservation | **367 originals accounted for; 359 unchanged; 8 integrated changes backed up exactly; 0 missing** | SHA-256 comparison. See upgrade-backup/PRESERVATION.json and .txt. |

Raw logs and synthetic screenshots are in `qa/`. Tests were rerun from a newly extracted final ZIP; the final-package verification JSON is supplied alongside the download. Counts above are individual tests/checks, not security certifications or production acceptance gates.

## Browser verification: explicit limitation

Managed browser navigation is disabled in this execution environment. The UI test used the documented `UI_DOM_HARNESS=1` mode: HTML/CSS/JavaScript were loaded into an empty browser page and a bridge restricted to the loopback fixture exercised the HTTP API. No browser policy was changed. This checks rendering, interaction, errors, forms, selected workflows and mobile overflow, **not native browser navigation, the deployed Content Security Policy, browser cookie/network behavior or a live infrastructure stack**.

Fixture credentials/data are confined to `tests/university/ui-fixture-server.mjs`, which requires explicit test enablement, binds loopback and refuses production. The screenshot is visibly labelled SYNTHETIC UI TEST. Its inventory figures do not describe a real university and are not production seed data. The 14 checks include all 12 module views, typed create forms, invitation secret clearing, a deterministic insight, logout, portal validation/consent and zero uncaught JavaScript errors. The portal UI fixture is not a substitute for real capability/database integration tests.

## Added implementation surface

19 new PostgreSQL tables, two new invoker-security views, 22 KPI definitions, one non-destructive schema migration (002), 85 staff-authenticated operations plus two capability-only portal operations, eight university service/repository/router modules and a responsive university console. Migration 001 and the older schemas were not rewritten.

The code reference `HLD-AND-FULL-CODE.md` includes 67 complete integrated scale-api source, configuration, API and test files, including existing core code. The ZIP additionally preserves the separate old SQLite demo, original Neon project and historical documentation. The codebook does not duplicate those separate old applications.

## NOT executed or established

Actual PostgreSQL migration/RLS/constraint/transaction execution; multi-process races; real private object storage; actual ClamAV engine/file quarantine; Docker build/Compose boot; network dependency/image downloads; external service failover; live browser CSP/navigation; Windows launchers; production authentication/SSO; penetration/security testing; representative load/latency/capacity; disaster recovery/restore; accounting assurance and real-invoice acceptance. The original Neon TypeScript build and its test suite were not run. The environment has no PostgreSQL service, Docker or installed `pg` dependency; registry resolution was unavailable. No supported-university/user-count or SLA is claimed.

A guarded real PostgreSQL suite is provided in `tests/university/postgres.integration.mjs`. It covers migration repeatability, app/worker privileges, RLS, overlap concurrency, snapshots, correction/void flows, capabilities, reporting and immutability. It requires a disposable database with a name ending `_test`. Its document scan metadata is labelled a synthetic fixture, not actual malware scanning. Run the original core PostgreSQL suite first on an empty disposable database, then this suite. Neither is counted in the 205 passing tests.

## Important functionality boundaries

AI/OCR/ERP/IoT/email providers are not connected. Insight answers are deterministic SQL-backed facts, not generative AI. Invoices reuse the existing private storage and scanning workflow; humans supply and verify extracted consumption. Student commute/travel is a separate supplemental product boundary. All 15 Scope 3 categories have a relevance register, not 15 complete sector-specific calculators. Scope 2 market-based accounting, offsets, investment attribution and supplier auto-posting are not implemented. PCF is physical-factor screening, not a certified LCA/EPD. Materiality is an exploratory survey with response thresholds, not statutory double-materiality or a privacy proof.

Report export is JSON/CSV/printable HTML, not native PDF/Word/Excel. No automatic STARS, BRSR, CSRD, GRI or ISO compliance claim. Planned reductions never deduct actual inventory. Formula and factor provenance are retained, but the institution must approve its real sources and accounting boundary. JSON report snapshots are bounded to 5000 inventory/metric rows; larger asynchronous report generation is a future scaling task. The new console's advanced nested workflows use typed/JSON forms, not a custom visual editor for every module.

## Reproduce local checks

```bash
# From the extracted project root:
npm test
cd scale-api
npm test
npm run check:university
node scripts/build-university-docs.mjs
node scripts/build-university-codebook.mjs
```

To run UI tests, install Python Playwright and a compatible browser separately. On an ordinary environment the test defaults to direct browser navigation:

```bash
BROWSER_EXECUTABLE=/usr/bin/chromium python tests/university/ui-check.py /tmp/university-ui-qa
```

The DOM fallback used for this delivery adds `UI_DOM_HARNESS=1`; results JSON records this mode. Always perform the native browser test against the staging deployment before public use. See PRODUCTION-GATES.md and UPGRADE.md.
