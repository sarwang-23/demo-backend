# Neon .env configuration update - verification

Release: 2.4.0-operations-rc.1.env.1

This update configures the existing operations backend for an operator-supplied Neon database and local supporting containers. It does not create a second backend or claim live deployment.

## Executed checks

| Check | Result | Limit |
|---|---|---|
| New environment/helper tests | 36 passed, 0 failed | Offline: safe templates, URL normalization, separate roles, TLS flags, secret preservation, literal .env rendering, CLI behavior, conflict checks, redacted logs and migration pooler guard. |
| Existing core/unit/HTTP/adapter regression tests | 94 passed, 0 failed | Selected existing tests; not the entire prior 531-test suite. |
| Core syntax/API check | 44 syntax files, 34 core paths | Static check, not runtime integration. |
| University syntax/API check | 114 syntax files; 151 university operations | Migrations 001-005 discovered/checksums unchanged; no SQL executed. |
| New Compose YAML structure | Parsed with PyYAML; explicit service-role separation checked | Not Docker Compose execution or build. |
| Source preservation | 652 original paths retained; 640 byte-identical, 12 updated with exact original backup | See ENV-UPGRADE-PRESERVATION.json. |
| Full-code manifest | 156 files hash-verified | Safe examples included; private .env excluded from the codebook. |
| Delivered .env | Placeholder-only | No usable remote credentials or generated local secrets shipped. |

Environment tests execute fixture-only CLI setup in temporary directories. Random secrets are generated there, checked for preservation/no logging, and removed after the test. The delivered .env remains uninitialized until the user inserts the rotated owner URL and runs env:prepare locally.

## Not executed

No user credential was used. No Neon database, role/password rotation, migration, S3 service, live antivirus service, paid OCR/AI provider, email relay, Docker build/start, package registry installation or native Windows launcher was exercised. Old PDF/OCR/UI suites were not rerun for this configuration-only change. The existing README reports for prior releases remain historical results, not new measurements.

The runtime connection profile uses direct Neon URLs and verified TLS, with pg channel binding enabled when offered. Live certificate/auth/privilege checks remain to be performed against the user's chosen demo branch. A passing env:check explicitly returns databaseContacted=false.

## Changes and security

Owner credentials are provided only to the migration/provision container. API uses cs_api; worker uses cs_worker. The new Compose profile does not start a local PostgreSQL database. It publishes API port 5000 only on loopback and retains internal port 8080. Local storage/scanner are real configured services, not mocked in the deployment file, but were not started here.

The posted API secrets are not used by this scale-api and were not included. The helper generates new local secrets on the user's machine; that does not rotate any existing remote role. Existing installations must preserve credentials, encryption keys and exact evidence-object versions. Automatic migration from the original Neon backend is not implemented by this change.

Raw local test outputs: env-tests.tap, core-regressions.tap, check.txt, check-university.txt and compose-static.json in this directory. Final archive extraction results are recorded in PACKAGE-CHECK.json.

Final archive extraction: 130 selected configuration/core tests passed, 0 failed, 0 skipped. All archived bytes matched the source staging tree, and 156 full-code hashes matched. Shipped placeholder .env correctly fails env:check until the rotated owner URL is supplied and setup secrets are prepared. No remote provider was contacted.
