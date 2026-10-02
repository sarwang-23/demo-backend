# CarbonSynq full-source delivery - Verification

Delivery date: 2026-10-02. Package version: 1.0.1. Actual execution runtime: **Node v22.16.0 on Linux**.

## Scope of these results

These results apply to the runnable root `server.mjs` + `lib/` application. They do not apply to the separately preserved original Express/TypeScript/Drizzle/Neon application.

## Fresh executions in this delivery

| Check | Result |
| --- | --- |
| `npm test` | **43 passed, 0 failed, 0 skipped**: 10 unit, 29 HTTP integration, 4 operations tests. |
| `npm run demo:flow` | PASS: real loopback HTTP login/manual entry/invoice upload/separate reviewer/calculation/dashboard/report/original-byte download. |
| Root JavaScript syntax | 14 source/test/example/browser files passed `node --check`. |
| OpenAPI references | All 55 local `$ref` occurrences resolved. This is structural reference validation, not a proof of complete contract correctness. |
| Normal Linux launcher | `sh START-BACKEND.sh` ran against a fresh temporary disk database; health, login, dashboard, static UI and API-doc endpoints responded. |
| Graceful shutdown | PASS; process exited 0 and removed its own PID lock. |
| Production CLI guard | `NODE_ENV=production` refused startup as designed. |
| Original source preservation | All 242 original files compared byte-for-byte against the uploaded ZIP; **0 changed**. |

The HTTP workflow fixture independently observed:

```text
Manual activity: 1,250 kWh -> 887.5 kgCO2e -> CALCULATED
Invoice activity: 12,500 kWh; amount INR 112,500 -> 8,875 kgCO2e -> CALCULATED
Dashboard delta: 9,762.5 kgCO2e
Calculated records added: 2
Invoice bytes downloaded: identical to the uploaded original
Report and dashboard: reconciled
OCR connected: false
Persistent demo database modified by this fixture: false
```

The factors are illustrative demo assumptions, not approved emissions factors. The new example uses the supplied known synthetic invoice; it must not be used to bypass human review of real invoices.

The normal-startup smoke check observed 38 synthetic activities, 36 calculated activities and 289,339.8 kgCO2e before additional demo entry. It exercised real local HTTP requests, not a browser rendering session.

## Packaged-copy check

The release archive is extracted into a separate working directory and `npm test` and `npm run demo:flow` are rerun there. Exact packaged results are included in `packaged-test-results.tap`, `packaged-api-workflow.txt` and `packaging-verification.json`.

## Evidence

- `current-test-results.tap`: current root test output.
- `current-api-workflow.txt`: current full-workflow example output.
- `current-checks.json`: syntax/OpenAPI/launcher/source-comparison results.
- `ORIGINAL-SOURCE-MANIFEST.json`: original paths, byte sizes and SHA-256 digests.
- `SOURCE-CATALOG.json`: inventory of the delivery, excluding self-referential/generated catalog files.

Previous browser-harness verification and screenshots are retained under `previous-delivery/` and `screenshots/`. Those are previous-delivery evidence, not a new native browser run. This pass did not change the root demo UI or its service implementation; it moved that application to the package root, added documentation/examples and preserved the entire original project separately.

## Not verified / not implemented

Native Windows/macOS launchers and a native browser-to-localhost session were not executed in this delivery. No public deployment, load test, penetration test, malware scanner, production OCR, SSO, approved factor integration or real-invoice extraction benchmark was performed. No original Neon database was connected, modified or migrated. The original TypeScript build and original test suite were not run; dependency installation was not retried. Original source issues described in the HLD remain unresolved in the preserved copy.

Passing local tests is not production-readiness, accounting assurance, regulatory compliance or security certification. Rehearse on the actual meeting laptop and keep the public demo accounts off the internet.
