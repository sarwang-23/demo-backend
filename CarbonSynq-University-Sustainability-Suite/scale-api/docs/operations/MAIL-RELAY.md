# Email delivery contract and local capture

`MAIL_MODE=disabled` is the safe default without credentials. New local setup deliberately selects `capture`, which writes a private development-only JSON message and never sends an email. Production forbids capture. In-app inbox notifications do not depend on mail delivery.

A production operator can set MAIL_MODE=webhook, MAIL_ENCRYPTION_KEY (64 random hex characters), MAIL_WEBHOOK_URL (fixed trusted HTTPS URL), MAIL_WEBHOOK_SECRET (32+ random characters), and PUBLIC_BASE_URL (exact trusted HTTPS origin). The API and worker must use the same encryption key. Do not rotate it while expecting old queued envelopes to decrypt without a recovery plan.

The worker posts JSON `{id,to,subject,text}`. It sends `Idempotency-Key: <outbox UUID>`, `X-CarbonSynq-Timestamp: <Unix seconds>` and `X-CarbonSynq-Signature: <hex HMAC-SHA256>`. The signed bytes are `timestamp + '.' + exact HTTP body`. The trusted relay must verify this with a constant-time comparison, enforce a bounded replay window, store/deduplicate the idempotency key, and return 2xx only after it has durably accepted the message. Never expose the relay as an unrestricted public mail-sending proxy.

The caller does not follow redirects and uses a 10-second network deadline. Failure goes through the existing durable retry/dead-letter queue. A process crash after a provider accepts the message but before the job is acknowledged can cause a retry; provider idempotency is required. No exactly-once inbox guarantee is made.

`PENDING`: queued. `CAPTURED`: local file, not email. `SENT`: configured relay accepted it, not proof of recipient delivery. `CANCELLED`: expired/revoked/inactive. `FAILED`: current attempt failed; consult the job/dead-letter state before assuming final failure. The admin outbox view excludes addresses, tokens and bodies. Delivered/captured database envelopes are erased, but development capture files remain until the tmpfs is recreated or explicitly cleaned.

No SMTP account, Gmail account, mail vendor, bounce webhook or SMS provider is silently configured by this ZIP. SSO/MFA is still a separate identity-provider project.
