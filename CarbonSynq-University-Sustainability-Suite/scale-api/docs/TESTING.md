# Testing guide

## Suites and boundaries

`npm test` runs 94 offline tests with Node's native runner. It does not require pg/AWS packages or a database. Unit cases cover decimals, invalid input, workflow/roles, password/token helpers, parsing and configuration. HTTP tests use a real Node HTTP server with injected service doubles. Adapter tests verify transactions/SQL structure/receipt behavior and use an actual local socket server speaking controlled ClamD replies. That socket server is not a malware engine.

`npm run check` syntax-checks executable JavaScript files and validates that the OpenAPI JSON has the expected API entry. This is not a TypeScript type check, a complete OpenAPI semantic linter, or PostgreSQL parsing/execution.

`npm run test:integration` imports pg and requires a fresh disposable PostgreSQL database ending in `_test`. It does not delete existing data; it refuses a populated application schema. Supply TEST_DATABASE_ADMIN_URL plus optional TEST_API_PASSWORD/TEST_WORKER_PASSWORD. It migrates real tables/roles and tests isolation, grants, identity, concurrent idempotency, workflow, exact calculation, immutable rows, quota and recovery. Object storage and scanner are explicit fixtures. The test itself does not claim real S3/antivirus verification.

The parent `.github/workflows/scale-ci.yml` sets up a disposable PostgreSQL service, installs dependencies, runs the checks and integration suite, audits packages, and runs the preserved root tests. It is a supplied workflow, not an already-passed external CI result.

UI verification renders the local HTML/CSS/JS in Chromium via a fixture harness. Fetch calls are mocked, and screenshots clearly identify synthetic workspace data. Browser localhost navigation was blocked by the execution environment, so deployed browser networking/CSP and real backend integration were not tested by that harness.

## Required external integration cases

Use the real versioned S3 bucket and ClamAV. Test clean text/PDF, image/manual fallback, encrypted PDFs, over-limit scan contents, incorrect MIME/signature, duplicate bytes/logical invoice, failed PUT and late PUT completion, changed object versions, missing version access and a harmless approved antivirus test. Confirm no quarantined original is served. Keep these tests off live customer data.

Run multiple API/worker processes and interrupt them around transaction commits/queue claims/finalizations. Check one immutable calculation per activity, exact monthly/ledger agreement, quota reconciliation, tenant isolation, period locks, expired sessions and request-key conflicts. Confirm no raw credentials or invoice bodies appear in logs.

Run the backup/restore and storage integrity drills from OPERATIONS. Run representative load measurements; the small read-only load-smoke script is not a replacement for these tests.

## Delivery evidence

See VERIFICATION.md for executed commands, counts, file-preservation checks and explicit unexecuted paths. Do not add mocked/integration-authored checks to the pass count of the actual offline suite.

## Reproduce the UI fixture

Install the optional Python Playwright tooling and its Chromium browser, then run `python tests/browser-ui.py` from `scale-api/`. This test loads the local assets without network navigation and mocks fetch. Outputs go to `ui-artifacts/`, or UI_ARTIFACT_DIR. This is not part of the 94 Node-test pass count or an end-to-end deployment test.
