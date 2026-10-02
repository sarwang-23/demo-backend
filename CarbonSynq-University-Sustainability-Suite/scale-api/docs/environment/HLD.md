# Environment deployment HLD supplement

Release: 2.4.0-operations-rc.1.env.1. Scope: connect the existing university application to an operator-selected Neon database with local-only supporting containers. Domain services, migrations and accounting rules are unchanged.

```text
Frontend :3000 / built-in UI localhost:5000
    -> loopback Docker port 5000 -> API container :8080
    -> cs_api -> direct Neon PostgreSQL + certificate-verified TLS
Worker -> cs_worker -> same Neon database
Operator migration/provision container -> separate owner identity -> same database
API + worker -> private versioned local object-store container
Worker -> ClamAV + existing Python/Poppler/Tesseract processing
```

The .env skeleton contains no usable secrets. Offline preparation accepts only the neon-local development profile, securely generates distinct local credentials, normalizes owner/API/worker URLs, and validates role/database/origin consistency. It preserves initialized secrets and rejects ambiguous configurations. Native environment-file loading already exists in package scripts.

compose.neon.yaml is deliberately separate: the old compose.yaml overrides database URLs with local-Postgres values and must not be used for this profile. Only migration/provision receives owner credentials. API and worker are passed an explicit environment whitelist, not the entire .env. Sensitive configuration is excluded from Docker build context and Git.

A copied Neon pooled hostname is converted to direct for all three identities. This retains the existing driver session-timeout behavior, while owner migrations need a session advisory lock. DB_CHANNEL_BINDING enables pg channel binding when the server offers it; it does not assert mandatory libpq require semantics. The existing runtime owner/BYPASSRLS rejection remains active. Migrations additionally reject pooled owner endpoints before a database connection is attempted.

Local port 5000, origins 3000/5000 and the public origin are coordinated. Internal container port is 8080. Hosted TLS, real IAM/S3, live mail, SSO and frontend contract adaptation are not configured by this local profile. Existing multi-invoice intake, governed factors, approval and tenant logic are not replaced with mocks.

Source additions: scripts/neon-env-lib.mjs, scripts/prepare-neon-env.mjs, scripts/check-neon-env.mjs, compose.neon.yaml, .env.neon.example, tests/env/neon-env.test.mjs. Small integration changes wire pg's binding option through config, pool, migration and provisioning clients. See SETUP.md for old/new variable mapping and VERIFICATION.md for executed versus pending checks.
