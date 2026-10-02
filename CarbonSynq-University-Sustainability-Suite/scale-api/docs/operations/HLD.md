# CarbonSynq University Operations - High-Level Design

Release `2.4.0-operations-rc.1` | 2026-10-02 | Additive upgrade to `2.3.0-ingestion-rc.1`

## 1. Delivery and boundaries

This release extends the existing PostgreSQL `scale-api`. It does not replace it with a disconnected demonstration. The root SQLite demonstration, original Neon repository, existing university modules, enhanced Scope 1/2 workflows, spreadsheet normalization and multi-PDF intake remain in the package. Migration 005 adds operational controls; migrations 001-004 retain their original bytes.

The completed code covers scoped evidence sharing, staff invitations and password recovery, audited reassignment, in-app notifications and a configurable delivery outbox, optional local English OCR, bounded background inventory export, evidence holds/dependency inspection, and coordinated backup tooling. These are implemented features with local tests, not a claim that the external infrastructure, entire institution access policy, restoration process or accounting methodology has been certified.

## 2. Topology

```text
Browser: /operations         /account        /university/imports
          |                      |                    |
          | bearer staff API     | rate-limited       | existing intake
          |                      | public endpoints   | + explicit OCR request
          v                      v                    v
Existing HTTP middleware, role guards, tenant transactions, audit, idempotency
          |
          +-- Evidence policy: private / campus / department / named grant
          +-- Accounts: expiring one-use token hashes + session revocation
          +-- Responsibility: task / source / corrective action transfer
          +-- Notifications: transactional audit trigger + own-user inbox
          +-- Inventory export request: locked period + independent review
          |
          v
PostgreSQL migrations 001-005, forced tenant RLS, dedicated API/worker roles
          |
          +-- existing durable, lease-fenced jobs
          |     + OPS_SWEEP       -> overdue inbox updates / outbox
          |     + SEND_MAIL       -> encrypted outbox -> capture OR HTTPS relay
          |     + OCR_DOCUMENT    -> exact CLEAN bytes -> bounded English OCR
          |     + BUILD_EXPORT    -> snapshot pages -> versioned CSV/JSONL
          |
          +-- Private versioned object store: original evidence + export bytes

Operator-only: exported DB snapshot -> pg_dump + exact referenced object versions
              -> checksum manifest -> non-destructive local verification
```

No browser token is stored in localStorage or sessionStorage. Authentication remains page-memory based; switching consoles or reloading can require another sign-in. The new workbench provides ordinary forms rather than requiring JSON for its operational actions. Existing advanced university forms are unchanged.

## 3. Evidence-access policy

`ADMIN`, `REVIEWER` and `LEADERSHIP` intentionally retain university-wide evidence access. An authenticated `ENTRY` user can read their own uploaded evidence, a document explicitly granted to them, or deliberately shared evidence matching an active campus/department membership. A campus-wide membership includes matching departmental scopes; a department-only membership is not a campus-wide entitlement.

Documents without sharing metadata default to private. This applies to existing evidence after upgrade. It is a restrictive behavior change: administrators must review needed grants before departmental users resume work. Memberships/grants are audited and revocable, but revoking one permission does not revoke independent uploader or university-wide role access.

The same predicate is applied to document listing and direct metadata/download. University-store evidence resolution and intake document resolution also enforce it. Original file cleanliness and hash/size checks remain mandatory. Core legacy activity detail/list reads are restricted to the creator for ENTRY; administrative ledger/audit exports are not exposed to ENTRY. This is **not full attribute-based departmental authorization for every university entity or every reviewer role**. Existing aggregate dashboards may still present institution-wide aggregates. Agree a stricter institution policy before claiming complete departmental confidentiality.

Operations transactions recheck active university and current user role, locking the tenant before account rows. Sensitive account changes cannot complete concurrently with an already-authorized operations transaction. API business rules supplement tenant RLS; the shared cs_api database role is not a separate database principal per employee. Privileged database operators remain outside these application guarantees.

## 4. Staff account lifecycle

Administrator invitations require the administrator's current password. The email must not already have a staff account. The account is created only after a valid link is consumed. Recovery does not reactivate disabled accounts, change roles or reveal whether an account exists in its public response.

Each credential has a random 256-bit nonce, tenant/token identifiers, purpose, expiry and consumed/revoked state. Only its digest is stored in the credential table. Reset links expire after 30 minutes; invitations after 24 hours. A password fingerprint invalidates reset links after an intervening password change. Issuing a newer link revokes prior unconsumed links for that account. Acceptance takes locks, validates current account/issuer status, consumes once, and revokes existing sessions for password recovery. The user must explicitly sign in again.

Links use a URL fragment, not a query-string token. The account page removes the fragment from history immediately and sends the token in a JSON body. Public endpoints use database-backed rate limits and the existing HTTP authentication-concurrency limit. Generic reset responses have a minimum-duration delay. No API returns recovery tokens or message bodies; no staff invitation response is stored in the general idempotency response cache. Reissuing an invite therefore replaces the prior link rather than promising delivery exactly once.

SSO/SAML/OIDC, MFA, email-domain ownership governance and mailbox deliverability are not implemented by this release.

## 5. Notification and delivery semantics

An audit trigger creates in-app notifications in the same transaction as selected workflow events: collection task assignment/reassignment, submission review outcomes, source responsibility transfer, corrective-action updates, carbon submission/rejection/calculation and completed export availability. Approval itself remains a separate domain action.

A tenant-scoped recurring job checks open overdue collection tasks every five minutes, using UTC calendar dates and one notification per task/user/day. Dedupe occurs before the 500-row selection limit so later sweeps can progress. Personal preferences control overdue reminders and optional email. Muted or delivery-disabled historical notifications are not later replayed as an email flood.

The outbox encrypts payloads with AES-256-GCM, bound to tenant and outbox ID. It supports:

- `disabled`: inbox works, but account invitations cannot be issued and reset delivery is not attempted.
- `capture`: development-only 0600 message files. No email is sent. This mode is rejected in production.
- `webhook`: a fixed operator-configured HTTPS relay. Requests carry a timestamp, HMAC signature and Idempotency-Key. The relay must validate signatures, enforce its own replay window and honor idempotency after uncertain delivery.

Expired/revoked credentials and inactive recipients are cancelled before sending. Delivered/captured payloads are removed from the database envelope field. Status `SENT` means relay acceptance, not guaranteed inbox delivery or bounce handling. Worker fencing protects database acknowledgement, but cannot undo a message that an external provider already accepted; provider idempotency is essential. Key rotation and old-message replay require an operator procedure. Local capture files contain sensitive links and are not exposed via HTTP.

## 6. Reassignment invariants

Open collection tasks can transfer assignee and separate reviewer. Source transfer changes only owner and ownership version; code, unit, kind and all accounting identity stay immutable. A new SQL trigger permits only this narrow source update. Open corrective actions can transfer owner.

New owners must be active and have compatible roles. Transfers require an explanation and current version. Pending drafts/submissions must be explicitly returned for correction when required. Original authors, historical approvals and calculation snapshots never change ownership retroactively. A new owner creates a new revision rather than becoming the author of someone else's evidence. Completed/closed work is not silently moved.

Transfer history is append-only. Source transfer serializes with enhanced Scope 1/2 writes using the same university governance advisory lock. These concurrency designs still require real PostgreSQL acceptance tests; memory-store tests are not proof of SQL locking behavior.

## 7. Scanned invoice OCR

Local English printed-text OCR is optional (`OCR_ENABLED=true`). An uploader or administrator requests it only for a CLEAN, REVIEW_REQUIRED, unlinked document with no imported intake rows. The request snapshots the old extraction, document version and digest. The worker verifies exact original object bytes, then invokes a restricted Python child with no application secrets and no shell.

Tesseract English and Poppler are included in the runtime Dockerfile. Usable PDF text layers are retained; image-only pages are rendered and OCR'd. The output retains page references, word boxes and raw engine confidence. Engine confidence is **not** a calibrated probability that an accounting field is correct. Every quantity, unit, date, vendor and source still needs human review. No OCR result automatically creates, approves or calculates an activity.

Bounds: 10 MiB original, 10 pages/request, 20-megapixel source images, bounded page rendering/text/output, 80-second outer timeout, Linux memory/CPU/file limits, process-group termination. Handwriting, non-English text, complex tables and poor scans may require manual entry. This is not a hardened malware-proof parser sandbox.

At completion the worker rechecks its lease, active tenant, document version/scan status and absence of imported rows. Evidence resolution holds a shared document lock while creating downstream records; OCR replacement takes the conflicting exclusive lock. Original bytes are never overwritten. Existing staged rows are not silently changed: refresh and normalize again to create a new review generation.

## 8. Background inventory export

An administrator requests CSV or JSONL for a locked reporting period. The request snapshots its version. A worker reads a repeatable-read database snapshot in pages of 500, with keyset ordering by calculation ID **and ledger**. It serializes at most 100,000 rows and 32 MiB, calculates exact decimal totals, escapes formula-leading CSV values, and stores a digest plus exact private object version.

Each lease attempt writes to a distinct object key. The current job lease and reporting-period version are rechecked before publication as READY. Another administrator or reviewer inspects the exact preview bytes and independently approves or rejects them. Creator self-approval is forbidden. Leadership can download only approved artifacts. Previously approved exports remain identifiable historical snapshots after a later period change; they are not silently re-labelled as current.

Primary totals use Scope 1 plus location-based Scope 2 plus Scope 3. Market-based Scope 2 is an alternative, not an additional amount. Missing market results remain unknown, not invented zeros. Student supplemental travel and biogenic CO2 are separate. This feature is an inventory export, **not the full narrative/frozen-report composer**; the old synchronous report bounds remain.

Product limits: at most three queued/processing requests and 100 retained export records per university. Export artifacts are bounded separately, not charged to the original evidence-quota counter. Failed lease attempts can leave orphan versions; an externally reviewed object-lifecycle/orphan policy is still needed. Automatic artifact deletion is not added.

## 9. Retention and backup

An administrator can record/release evidence preservation holds and inspect known record/report dependencies. There is no automatic original deletion, redaction, legal-hold certification or claim that the dependency list is an exhaustive compliance decision. Existing evidence is retained.

The operator-only backup script exports one PostgreSQL snapshot, captures document/export object-version references from that snapshot and runs pg_dump against it. After the dump completes it releases the DB transaction, retrieves those exact immutable versions, verifies bytes/hashes, and writes a completed manifest only when all objects succeed. An explicit privileged backup identity and all-tenant acknowledgement are required. No HTTP backup/download endpoint is exposed.

A separate local verifier rejects incomplete manifests, bad paths, symlinks, missing files and hash/size mismatch. This tests integrity, not recoverability. The bundle contains sensitive cross-tenant data and needs external encryption/access controls. Quarantined bytes are stored as .bin and must never be opened automatically. A newly populated S3 bucket cannot generally reproduce original version identifiers; provider-native recovery or a separately reviewed reference-remapping procedure is required. No destructive restore command is supplied or claimed tested.

## 10. Database and API additions

Migration 005 creates 10 tenant-scoped tables: memberships, document scopes, named grants, credential tokens, notifications, preferences, encrypted mail outbox, export requests/manifests, OCR runs, and immutable reassignment history. It adds users.email_verified_at and sources.ownership_version, worker permissions, queue kinds, audit notifications and recurring sweeps. Secret tables have explicit service methods rather than generic resource endpoints.

There are 28 new authenticated operations and 2 public account operations. Staff routes reuse bearer authentication, role checks and Idempotency-Key for ordinary mutations. Exact endpoints and body contracts are in `API-REFERENCE.md` and `openapi.json`. The existing university/intake contract remains separate. All accepted writes remain tenant-derived, not caller-directed tenant switching.

## 11. Verification and release gates

See VERIFICATION.md for measured results. Standard tests exercise original behavior, account/token controls, sharing/revocation, transfer rules, rollback in memory, notification semantics, serializers, exact backup files, worker adapters and HTTP routes. One separate real English OCR fixture was executed; it is not an accuracy benchmark. The console was checked with a Chromium DOM/local-HTTP harness after native browser navigation was blocked by the execution environment.

Real PostgreSQL migrations/RLS/locking, S3, ClamAV, Docker startup, dependency lock resolution, real mail delivery, native browser/CSP, restore, load and penetration tests remain outstanding. Existing npm direct dependencies were not silently upgraded; registry DNS failed and no fabricated lockfile was supplied. Production approval also needs the institution's own factors, organizational boundaries, role policy, retention policy and sign-off.

Technical references used during implementation, not certification of this application:
- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- https://tesseract-ocr.github.io/tessdoc/
