# Verification record

Delivery: 2026-10-02. These results apply to the new `university-demo/` application, not the original Express/Neon service.

## Executed backend tests

Command, from the project root:

```sh
npm run demo:test
```

**43 tests passed; 0 failed; 0 skipped.** The suite contains 10 unit tests, 29 HTTP integration tests and 4 local operations tests. Tested with Node **v22.16.0** on Linux. Built-in SQLite emitted its expected experimental-feature warning on this runtime.

Integration tests start a real HTTP server bound to ephemeral loopback ports and use Node fetch/multipart requests against the application. They use isolated memory/temporary databases, not a remote service or real university records. Persistence tests close and reopen a file-backed database.

Coverage includes:

- Valid and invalid sign-in, session revocation, unauthenticated requests and read-only role guards.
- Tenant-scoped metadata, CRUD and evidence downloads, including foreign-tenant denial.
- Campus/building ownership, period dates, canonical units, positive finite quantities and precision validation.
- Read-only preview; drafts excluded from emissions totals.
- Concurrent manual-create idempotency, conflicting payloads, justified duplicates and prevention of duplicate-by-edit bypass.
- Expected-version checks, ordered workflow, separate reviewer verification, rejection/correction and period lock enforcement.
- Exact calculated deltas, factor snapshots, idempotent calculation and report reconciliation.
- Real multipart uploads, original-byte hash preservation, separate consumption/currency values, required human confirmation, logical/file duplicates and scanned-image manual fields.
- Unsupported/mismatched file types, invalid JSON, multiple files, unauthorized uploads and cross-origin requests.
- Audit update/delete denial, retained audit on draft deletion, pagination and CSV formula neutralization.
- Runtime PID lock, stopped-server backup, reopenable backup integrity, unconfirmed-reset refusal and confirmed reset preserving old data.

Raw test results are included as `test-results.tap`. Test duration is recorded there; it is not a performance benchmark.

## Browser UI checks

The application's actual HTML, CSS and JavaScript were exercised in system Chromium through Playwright, at desktop 1440 x 1000 and mobile 390 x 844 viewports. The managed browser in this execution environment refused direct localhost navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`.

Therefore, the browser check used an **offline DOM harness with a Python HTTP bridge to the real running Node API**. The bridge transported genuine JSON/multipart requests and actual responses; business logic was not mocked. A test-only randomUUID shim was used because about:blank is not a localhost secure context. These harness helpers are not part of the shipped application.

Nine scenario checks passed: administrator login/seed overview; manual entry/preview/submit; separate reviewer transitions; PDF upload with 12,500 kWh and INR 112,500 suggestions; invoice confirmation and linked activity calculation; CEO read-only controls/updated total/CSV response/audit screen; mobile layout without document-level horizontal overflow; offline API reference and served OpenAPI; no uncaught JavaScript errors during the scenario.

This validates UI interaction and real backend integration **through that harness**. It does not establish a successful native browser-to-localhost session, validate browser CSP enforcement, prove cross-browser support or verify the user's Windows environment. The API's host/origin checks were tested separately over HTTP. Native PDF viewer rendering could not be verified in this environment; the UI provides unverified readable-text display, an expandable original PDF preview and original download, so a viewer failure does not imply fabricated evidence.

The included UI screenshots are genuine renders of this demo with synthetic data. They are not images of a live university deployment. `browser-qa-results.json` records the harness result and boundary.

## Additional checks

- The synthetic electricity PDF was rendered and visually inspected for legibility and field separation.
- SQLite backup was reopened and `PRAGMA integrity_check` returned `ok`.
- Original source preservation was checked by comparing against the supplied ZIP before packaging.
- The packaged archive was extracted and the independent Node test suite was rerun from that copy; see `packaging-verification.json`.

## Not executed or not established

Original npm dependencies could not be installed because the package registry was unreachable. The original TypeScript build and original Vitest suite were not run. No original Neon database was accessed or migrated. No production deployment, security penetration test, malware-scanner/OCR integration, load test, disaster-recovery drill or real-invoice accuracy benchmark was performed.

Windows/macOS launchers are included but were not run on those operating systems here. Rehearse on the actual presentation laptop before the meeting. Do not interpret passing local tests as a production-readiness or regulatory-compliance certificate.
