# Verification - CarbonSynq Scope 1 and Scope 2 upgrade

Delivery: **2026-10-02**. Version: **2.2.0-scope12-rc.1**. These are measured local checks, not a production certification.

## Measured results

| Check | Result | What this actually establishes |
| --- | --- | --- |
| Integrated scale-api tests | **293 passed, 0 failed, 0 skipped** | Includes the original 205 tests and 88 new exact-decimal, domain, HTTP, query/contract tests. Domain persistence is an explicit in-memory test double, not PostgreSQL. |
| Original SQLite demo regression | **43 passed, 0 failed** | The separate old demo still passes its supplied local tests. It is not the new scale-api storage backend. |
| New Scope 1/2 UI | **11 checks passed** | Chromium rendering, forms, roles, totals, source tabs, quantity preview, provenance and 390px layout via the local HTTP bridge. |
| Existing university UI | **14 checks passed** | Existing console/portal fixture regression via the same bridge. |
| Syntax/API check | **65 JS/MJS files checked; 134 staff operations documented** | Syntax plus route-to-OpenAPI coverage. Together with the two existing public portal operations, integrated university documentation contains 136 operations. |
| New API/schema inventory | **49 added authenticated operations, 10 new tables** | Counted registered handlers and executable migration definitions; not merely navigation labels. |
| Disposable arithmetic workflow | **Passed; saved university records changed: false** | Two synthetic sources through distinct approvers, separate location/market totals and ready declared coverage. |
| Migration continuity | **001, 002, 003; previous 001/002 hashes unchanged** | Migration ordering/checksums inspected. Actual PostgreSQL execution is a separate, unrun gate. |
| Source codebook | **85 complete source/configuration/API/test files** | Full integrated scale-api source is included after the HLD. Historical SQLite/Neon code remains in the ZIP but is not repeated in this book. |

The runtime was Node.js 22.16.0. The old built-in SQLite module emits its expected experimental warning on that runtime. Windows launchers and the Node24 Docker image were not executed here.

## What the new tests cover

Exact fuel-stock reconciliation; meter rollover/reset and multiplication; refrigerant balance and explicit leak-top-up; delivered-energy conversion; gross electricity imports; factor gas completeness and geography/date matching; configurable GWP; biogenic CO2 separation; factor immutability; separate reviewers; stale versions; tenant/source ownership; boundary coverage/no-activity; legacy activation conflicts; date gaps; certificate beneficiary/criteria/quantity/capacity; residual-before-grid local fallback; market alternatives; void/replacement and released active allocations; high-severity action closure; CSV atomic rejection; main-view reconciliation; frozen report alternatives and hash checks; correct evidence/record links; location/market target selection; HTTP unauthenticated/forbidden cases; documentation/SQL contract shape.

The supplied real-PostgreSQL acceptance script additionally defines concurrent allocation and activation cases, RLS/worker isolation, database immutability and period-lock tests. It was syntax checked, **not executed**. Assertions against SQL text do not establish actual SQL execution or RLS behavior.

## Rehearsal numbers are synthetic

`npm run carbon:demo` calculates 2,680 kgCO2e Scope 1, 70,000 location-based Scope 2 and 54,000 market-based Scope 2. Primary Scope 1+2 is 72,680; the market alternative is 56,680. The two alternatives are never summed. These are deliberately fabricated fixture factors and evidence, not a university inventory or approved emission-factor database. Nothing is seeded into live storage.

## Browser-test boundary

Native browser navigation to the local server returned `net::ERR_BLOCKED_BY_ADMINISTRATOR` in this environment. The available fallback renders the actual HTML/CSS/JavaScript in Chromium and routes application fetches through a Python-to-loopback HTTP bridge. This exercises rendering and real HTTP/domain handlers with a memory fixture; it does not validate native navigation, production CSP enforcement, cookie/transport policy or an actual browser-to-PostgreSQL/S3/scanner stack. QA JSON explicitly records these false flags. The previous fixture's '12 module views' check is retained as the old-suite count, not a claim that the new thirteenth nav item was omitted from the new test suite.

## Explicitly NOT verified

- Real PostgreSQL migration003, row-level-security execution, view compatibility, pooled sessions or cross-process locking under load.
- Real S3/MinIO policies, versioned objects, upload recovery, antivirus signatures or ClamAV scan execution.
- Docker Compose startup/build and the declared dependency/image resolution. The environment lacked Docker/PostgreSQL and registry name resolution was unavailable.
- Public deployment, penetration test, supply-chain audit, measured capacity/SLA, backup restore or disaster recovery.
- Native browser-to-server navigation/CSP and Windows launcher execution.
- Original TypeScript/Neon compilation, migration or frontend compatibility.
- Official factor accuracy, external certificate registry eligibility, independent assurance or legal/framework compliance.

No missing external integration is mocked into an approved production result. The application's synthetic test server is opt-in, loopback-only and refuses production mode; it is not an alternative data provider for normal startup.

## Reproduce locally

```bash
cd scale-api
npm test
npm run check:university
npm run carbon:demo
cd ..
npm test
```

For Chromium QA on a compatible environment, see `tests/carbon/ui-check.py` and `tests/university/ui-check.py`. The DOM-bridge mode used here is enabled by `UI_DOM_HARNESS=1`; this is an explicitly limited test mode. Native mode should be run on a supported staging browser as a separate gate.

For real PostgreSQL, install the declared dependencies and run `npm run test:carbon:postgres` against a disposable `_test` database with the guarded `TEST_DATABASE_ADMIN_URL`. See `UPGRADE.md` and `PRODUCTION-GATES.md` for all infrastructure and accounting acceptance conditions.

## Bundled evidence

`qa/backend-tests.txt`, `qa/legacy-sqlite-tests.txt`, `qa/syntax-and-api-check.txt`, `qa/synthetic-workflow.txt`, `qa/carbon-ui-results.json`, `qa/existing-ui-results.json`, and the labelled synthetic desktop/mobile screenshots. Original-file preservation is listed in the root `SCOPE12-PRESERVATION.txt` with SHA-256 pairs and backup paths.

## Input preservation

All **425** input file paths remain. **404** are byte-for-byte unchanged; **21** were intentionally updated for integration, contract/tests or historical-document pointers. The exact previous bytes of every changed file are retained under `upgrade-backup/university-v2.1/`. No original path is missing.
