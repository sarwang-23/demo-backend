# v2 API workflow reference

The complete route inventory is in `openapi.json` (34 paths / 41 operations). Request bodies are typed there; `Success.data` remains endpoint-specific, so this is not a fully typed client-generator contract. Source functions and examples below define the concrete workflow. Business responses are `{success:true,data,requestId}`; errors are `{success:false,error:{code,message,details?},requestId}`. Evidence downloads and metrics return their own content types.

## Session and metadata

```http
POST /api/v2/auth/login
Content-Type: application/json

{"tenantId":"<printed-tenant-UUID>","email":"<provisioned-email>","password":"<provisioned-password>"}
```

Use `data.token` as `Authorization: Bearer <token>`. It is opaque, not a JWT. GET `/api/v2/meta` for campuses, buildings, OPEN periods, categories and factor versions. GET `/api/v2/auth/me` for identity. POST `/api/v2/auth/logout` revokes the current session.

```http
POST /api/v2/auth/password
Authorization: Bearer <token>
Content-Type: application/json

{"currentPassword":"<old>","newPassword":"<12-to-128-character-new-password>"}
```

The password change revokes every session for the user, including the current one; sign in again.

## Create and approve a factor

ADMIN posts `/api/v2/factors` with an Idempotency-Key and the fields below. Supply an actual approved source/policy value, not a suggested universal constant:

```json
{
  "category": "PURCHASED_ELECTRICITY",
  "unit": "kWh",
  "value": "<positive decimal string from your selected methodology>",
  "versionLabel": "<factor-year-version>",
  "source": "<published source title>",
  "sourceUrl": "https://<source-host>/<source-document>",
  "region": "<applicable geography>",
  "methodology": "<accounting basis and applicability>",
  "validFrom": "2026-04-01",
  "validTo": "2027-03-31"
}
```

This illustrative template contains placeholders and is not directly submit-ready until filled. Another ADMIN/REVIEWER posts `/api/v2/factors/{id}/approve`. Approving your own factor is denied. Approved factors cannot be edited; create another version.

## Manual activity

```http
POST /api/v2/activities
Authorization: Bearer <entry-token>
Content-Type: application/json
Idempotency-Key: <stable-random-key-for-this-create>

{"periodId":"<UUID>","campusId":"<UUID>","category":"PURCHASED_ELECTRICITY","unit":"kWh","quantity":"12500.000000","activityDate":"2026-06-01","description":"Meter consumption, checked against source"}
```

Quantities are strings. Do not send tenant/university/scope overrides. Optional `buildingId` must belong to the selected campus. An intentionally separate matching input may include `duplicateReason` of at least 10 characters.

Response data includes `id`, `version` and snake_case fields. POST `/activities/{id}/submit` with `{"version":<latest>}`. A reviewer posts `/start-review` with the resulting version. A different reviewer posts `/verify` with `{"version":<latest>,"factorId":"<approved-factor-UUID>"}`. HTTP 202 means the calculation was queued, not already completed.

Poll GET `/activities/{id}` until CALCULATED or investigate the job queue. The calculated response includes its immutable `calculation`. Do not fabricate a calculated result when a worker is unavailable. Reject pending review with `/reject` and a reason. PATCH draft/rejected entries with the full activity input plus current version to return to DRAFT.

## Invoice upload and confirmation

```http
POST /api/v2/documents/upload
Authorization: Bearer <entry-token>
Content-Type: application/pdf
X-Filename: electricity-bill.pdf
Idempotency-Key: <stable-key-for-these-original-bytes>

<raw file bytes, not JSON and not multipart>
```

URL-encode special characters in X-Filename. Maximum file size is 10 MB. Supported types are PDF, PNG, JPEG and UTF-8 TXT. A replay of the same key/file returns the existing operation. Different bytes under the same key conflict.

GET `/documents/{id}` for status. UPLOADING means the storage outcome is pending; QUEUED means scanning has been queued; REVIEW_REQUIRED means a clean verdict permits human review; REJECTED means malware/scan policy rejection; LINKED means an activity is attached; UPLOAD_FAILED means reconciliation found no accepted object and released quota. Some failures are represented by the associated DEAD job while the document remains queued.

Only clean REVIEW_REQUIRED/LINKED evidence downloads through `/documents/{id}/download`. Confirm by posting `/documents/{id}/confirm` with an Idempotency-Key, the activity fields and:

```json
{
  "version": 3,
  "vendor": "Actual supplier",
  "invoiceNumber": "Actual invoice number",
  "amountInr": "112500.00",
  "reviewConfirmed": true
}
```

Use the current document version, not the example 3. `amountInr` is optional and separate from required actual `quantity`. The result is a DRAFT, not an approval. Submit/review/verify as above. Images/unsupported PDFs need manually entered fields. No AI OCR is available.

If UPLOAD_FAILED, only an ADMIN may POST exact original bytes to `/documents/{id}/retry-upload`. This is state-guarded and uses a fresh storage key internally, not a generic retry API. After a timeout, poll the existing document; do not repeatedly resend while it is UPLOADING.

## Administration and operations

ADMIN creates users/campuses/buildings/periods/factors with keyed POST requests. User access changes via PATCH `/users/{id}` revoke sessions and cannot remove the last active admin. Period lock/unlock requires `{version,reason}` and an open-period inventory with no unresolved activity before locking. Dead jobs can be retried by ADMIN with `{reason}`.

GET `/activities`, `/documents`, `/jobs`, `/campuses`, `/buildings`, `/periods`, `/factors` use `limit` and `cursor`; use only the returned nextCursor. Users list is ADMIN-only. GET `/audit-events` returns nextBefore; GET `/reports/ledger` returns nextAfter and explicitly is not a frozen snapshot. Optional periodId filters the dashboard and ledger.

## Retry semantics

For create/upload/confirmation, preserve the Idempotency-Key and exact payload when a network outcome is uncertain. Receipts last 24 hours; domain duplicate protections remain separate. For versioned PATCH or workflow transitions, GET the latest record before deciding whether to retry. A 409 is a conflict to reconcile, not permission to suppress checks. A 202 is accepted asynchronous work, not a success guarantee for downstream dependencies.
