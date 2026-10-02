# Required acceptance before a live university pilot

This is a release candidate, not an independently assured or production-certified system.

1. Resolve/review dependencies in a registry-enabled environment, create the correct scale-api lockfile, switch the release image to npm ci, pin reviewed container digests and execute hosted CI. Do not borrow the old Neon project's lockfile.
2. Apply migrations 001-005 to a disposable PostgreSQL instance, run all separate integration scripts, verify non-owner API/worker privileges and forced tenant RLS. Exercise role revocation, document share/grant revocation, concurrent recovery/transfer/import/OCR and worker lease loss. Migration SQL has not been executed in this delivery environment.
3. Start real object storage with private access/versioning and actual ClamAV signatures; test CLEAN, infected, timeout, storage outage, quota and interrupted uploads without disabling checks. Verify exact original-file bytes after restarts.
4. In a native browser verify HTTPS/origin/CSP behavior, account fragment handling, login/logout, every role and representative desktop/mobile actions. The delivered screenshots use a labelled DOM/local-HTTP fixture harness because native navigation here returned ERR_BLOCKED_BY_ADMINISTRATOR.
5. Use the university's own approved factors, organizational boundaries, reporting periods and role policy. Define university-wide reviewer/leadership evidence rights explicitly. Do not label the new policy as universal departmental confidentiality.
6. Configure a real mail relay and exercise HMAC verification, idempotency, revoked/expired links, worker failures, preferences and actual delivery/bounce behavior. Capture is never real email. Confirm reset and invite links use the trusted production origin.
7. Test English OCR on anonymized representative invoices and malicious/oversized inputs. Confirm ambiguous or wrong fields remain reviewable and never automatically approved; original bytes and existing imported provenance must not change.
8. Generate >5,000-row inventory exports on actual PostgreSQL, fail a worker mid-generation, verify lease fencing, stale-period rejection, exact decimal totals, independent approval and download integrity. Benchmark agreed data volumes; no concurrent-user capacity or SLA is claimed.
9. Execute coordinated backup and isolated restore of DB plus exact referenced object versions, environment/encryption-key recovery and meaningful integrity reconciliation. Record measured recovery objectives. Define orphan-version cleanup, retention, hold, redaction and privacy procedures separately.
10. Perform security review, representative load/failure testing, production TLS/secrets/storage restrictions, monitoring/alerts and incident ownership. Institutionally approve the pilot and perform the CEO walkthrough on the actual presentation machine.

Do not bypass antivirus, share every document or permit self-approval just to make a demonstration appear complete.
