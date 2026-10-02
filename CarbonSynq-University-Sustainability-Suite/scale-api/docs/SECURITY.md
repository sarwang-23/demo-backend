# Security model and limits

## Enforced in the new source

Authenticated tenant context, role guards, independent-person verification, non-owner runtime DB roles, forced RLS plus explicit predicates, composite tenant foreign keys, scrypt passwords, digest-only sessions, revocation, key-based create idempotency, record versions, bounded body/upload size, exact origin allowlist, escaped console rendering, security headers, parameterized SQL, private evidence keys, pinned versions and digest verification, scan-before-download, bounded parser thread, shared rate counters, structured request IDs and runtime append-only audit/ledger controls.

These controls are specific to `scale-api/`. They do not modify or secure the preserved older services.

## Trust boundaries

A tenant ID supplied at login is not trusted until credentials validate. The prefix of a token only selects the lookup tenant; the entire random token digest must match. Business APIs use the authenticated tenant, not arbitrary URL tenant selection.

A compromised server with application database credentials is inside the tenant-context trust boundary. RLS cannot protect against an attacker who can choose session settings and execute arbitrary SQL under those credentials. Owners/superusers can bypass/change protections. SQL injection prevention, runtime hardening, access review, network isolation and secret management remain necessary.

Invoice content is untrusted data. It is not executable instruction, approval evidence for itself, or authority to choose a factor. No LLM or cloud OCR is called. Signatures and antivirus are layers, not proofs of safety. Keep originals as download attachments; do not add inline HTML/PDF rendering without a reviewed sandbox policy.

ClamD traffic is unauthenticated and must remain private. Use maintained signatures, resource limits and security patching. The worker thread is not an OS sandbox. Consider a separate restricted parser process/service with stronger isolation before accepting hostile public upload traffic.

## Credentials and access

No generated `.env` or live credentials are included in the scale module. The setup script creates random local secrets only on explicit execution. Avoid publishing shell output from provisioning. The local fixture uses development object-store admin credentials; replace these with least-privilege workload identity in cloud deployments.

Use separate migration, API, worker, backup and observability credentials. Do not pass owner secrets to the runtime. `.env.example` is a reference inventory, not a production secret bundle. Runtime database names are deliberate safety checks; review any required change rather than using an owner role to bypass startup failure.

Browser tokens are in memory. Server sessions remain valid until expiration or revocation; closing a tab is not server-side logout. Password/access changes revoke sessions, but requests already authorized/in flight can finish. No MFA, SSO, brute-force proof, password reset email, anomaly detection or account-attack notification is claimed.

## Abuse and storage

Per-user/tenant/login rate buckets share PostgreSQL, while concurrency caps are per API replica. A hostile unauthenticated distributed attack still consumes network/process/database resources. Put edge controls and monitoring in front of the API. Readiness/metrics are not intended as unrestricted public diagnostic services.

Storage quota reserves logical accepted bytes. Cloud object versions and unreconciled orphans need separate inventory/retention controls. There is no automatic deletion pipeline that risks discarding evidence. Scanned-rejected documents remain quarantined, not automatically deleted. Design retention and access policy with the customer.

## Audit and compliance boundary

Triggers/grants prevent ordinary update/delete of audit/calculation rows. They do not constitute cryptographic tamper evidence or independent assurance. Privileged operators can change databases/objects. External immutable audit sinks, backups, separation of duties and legal retention require deployment-specific implementation.

No security penetration test, privacy-law certification, ISO/SOC certification, GHG assurance or regulatory compliance approval is supplied. The release gates require independent review and testing with the actual infrastructure and customer accounting policy.

Reviewer separation is enforced by distinct account IDs. The application cannot establish that two accounts are controlled by genuinely independent people. University access governance and eventual SSO mapping must enforce that organizational requirement.
