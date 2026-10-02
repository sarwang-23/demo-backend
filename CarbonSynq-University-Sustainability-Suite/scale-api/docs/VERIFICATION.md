# CarbonSynq Scale Foundation - Verification

**Source delivery:** 2 October 2026. **Decision:** additive source foundation, not production acceptance.

## Executed successfully in this environment

| Check | Result | Scope |
| --- | --- | --- |
| New module `npm test` | **94/94 passed; 0 failures; 0 skips** | Unit validation/workflow, real Node HTTP with injected service fixtures, database adapter/SQL-structure checks, local ClamD protocol fixture and parser worker |
| New module `npm run check` | **30 JavaScript files syntax checked; OpenAPI JSON parsed** | Does not execute PostgreSQL, type-check JavaScript or fully validate response schemas |
| OpenAPI route inventory | **34 paths / 41 operations** | Request schemas typed; Success.data is endpoint-specific, not fully typed client code generation |
| Preserved root demo `npm test` | **43/43 passed; 0 failures; 0 skips** | Existing local SQLite module, not the original Neon application's TypeScript tests |
| Preserved root `npm run demo:flow` | **Passed** | Manual + invoice approval/calculation; two added calculated activities; original invoice bytes preserved; report reconciled; temporary in-memory data |
| Console fixture checks | **11 passed; 0 page errors; 21 mocked API requests** | Chromium rendered local HTML/CSS/JS, desktop and 390px mobile; no page-level horizontal overflow |
| Compose static parsing | **Parsed as YAML; database secret separation assertions passed** | Not a Docker build or orchestration test |
| Original input preservation | **295/295 source files byte-for-byte unchanged at original relative paths** | SHA-256 comparison against CarbonSynq-Complete-Backend-With-HLD(3).zip; no original files missing or modified |

The existing flow's emissions delta is a synthetic test result using illustrative demo factors, not an official university inventory. It did not change a persistent demo database.

## Critical limits

**No live PostgreSQL, S3, ClamAV engine or Docker Compose integration was executed.** PostgreSQL/Docker binaries were unavailable here and the npm registry lookup failed with `EAI_AGAIN` for registry.npmjs.org. Dependencies, Docker images, MinIO source build, `npm audit` and production IAM/TLS were not validated in this environment.

The PostgreSQL integration suite is authored and syntax checked, **not passed**. Its future execution tests a real database but uses controlled S3/scanner fixtures, so it still does not replace live cloud and malware integration tests. The included GitHub workflow has not been run remotely.

Browser navigation to localhost was blocked by this environment. UI checks therefore loaded the real local assets through a test harness and mocked `fetch`. They verify rendering, dialogs, DTO construction, manual entry, invoice review/upload, setup, mobile layout and logout. They do **not** prove deployed network/CSP behavior, real authentication/storage or actual malware verdicts. Preview data is labeled synthetic.

No throughput, concurrent-user capacity, uptime SLA, native Windows launcher execution, production migration, official factor validation, security penetration test, backup/restore drill or live customer acceptance is claimed.

## Reproducible evidence

`verification/scale-offline-tests.tap` contains the new tests. `verification/preserved-demo-tests.tap` and `verification/preserved-demo-flow.log` contain the independent old-demo runs. `verification/ui-fixture-report.json` records UI cases and boundaries. `verification/registry-check.log` records the unavailable dependency registry. The parent SOURCE-PRESERVATION.json lists every original path/hash.

Commands from `scale-api/`: `npm test`, `npm run check`. Optional UI fixture: install Python Playwright/Chromium and run `python tests/browser-ui.py`. External database check: set a fresh disposable TEST_DATABASE_ADMIN_URL ending in `_test`, install dependencies and run `npm run test:integration`. Run the live deployment, security, accounting and recovery gates in PRODUCTION-GATES.md before customer use.

## Repository preservation

The parent root service remains the SQLite demo and `original-neon-backend/` remains unchanged. The new `scale-api/` is separate `/api/v2` code. None of the new passing tests imply that the old original TypeScript/Neon build has been installed, hardened or integrated. Old reports are retained as historical deliverables, not as evidence for v2.
