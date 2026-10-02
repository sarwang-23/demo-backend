# Audit gaps addressed - what is implemented versus still a gate

| Previous gap | Implemented in this upgrade | Still outstanding / boundary |
|---|---|---|
| A01 Real deployment | Additional HTTP/worker tests, preflight, disposable PostgreSQL acceptance script, updated CI invocation | Real PostgreSQL/RLS/locking, S3, ClamAV, Docker and full-stack acceptance were not executed here. |
| A02 Department permissions | Default-private ENTRY evidence; campus/department memberships, named grants, revocation; consistent document reads/downloads and evidence resolution | ADMIN/REVIEWER/LEADERSHIP intentionally remain university-wide. This is not all-entity, all-role department ABAC. |
| A03 Staff accounts | Password-confirmed invites, expiring one-use links, generic recovery, session revocation, encrypted outbox, fragment removal | Real email relay configuration/delivery, SSO/MFA and institutional email-domain governance. |
| A04 Staff transfer | Audited task assignee/reviewer, source owner and open corrective-action transfer; explicit return of pending work | Historical authorship/approvals intentionally never rewritten; regular master-data CRUD beyond these operations is unchanged. |
| A05 Notifications | Transactional in-app audit notifications, preferences, recurring overdue collection reminders, deduplicated retrying delivery adapter | Real mail/bounce provider. Not every institution-specific event or SMS channel is covered. |
| A06 Scanned invoices | Optional local English Tesseract/Poppler worker; page/word provenance; explicit review; existing intake button | Handwriting/non-English/poor scans and complex Excel layouts still need manual review. No field-accuracy guarantee. |
| A07 Demo UX | New operations forms, inbox and visible provider/queue status; account page; links from university/intake | Native browser/CSP and complete laptop rehearsal pending. No pre-seeded real-looking tenant/factors. Cross-console memory sessions can require re-login. |
| A08 Release build | Existing dependencies retained; Docker includes local OCR; versioned API/SQL docs and CI script updated | Registry DNS prevented lockfile resolution. Hosted CI, image digests, dependency install/audit and actual build remain unverified. |
| A09 Recovery/retention | Snapshot-coordinated database + exact-object backup code; actual-file integrity verifier; preservation holds and dependency review | Real backup/restore drill, external encryption/key recovery, destructive deletion/redaction and operational incident/retention policy. |
| A10 Larger reports | Paged background CSV/JSONL inventory export, exact totals/hash, independent review, 100k-row/32-MiB bounds | Full narrative report composer retains old bounds; load testing, orphan cleanup and universal capacity claims remain out of scope. |

All previous application file paths are retained. Exact original bytes of changed input files are saved in the upgrade-backup directory. Consult PRESERVATION.json for the measured path/hash comparison, and VERIFICATION.md for actual results rather than relying on older versioned screenshots or guides.
