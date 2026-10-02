# Operations API

Bearer authentication for staff routes. Tenant comes from the authenticated account, never a caller-supplied switch. All mutations require Idempotency-Key except password-confirmed staff invitation and public account endpoints.

| Method | Route | Roles | Purpose |
|---|---|---|---|
| GET | `/api/v2/operations/capabilities` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read actual operations configuration and explicit limits |
| POST | `/api/v2/operations/staff/invite` | ADMIN | Queue a single-use staff invitation after administrator password confirmation |
| GET | `/api/v2/operations/staff/invitations` | ADMIN | List staff invitations without exposing token hashes or tokens |
| POST | `/api/v2/operations/staff/invitations/:id/revoke` | ADMIN | Revoke an unconsumed staff invitation |
| GET | `/api/v2/operations/memberships` | ADMIN | Page active and revoked campus/department memberships |
| POST | `/api/v2/operations/memberships` | ADMIN | Create or revoke an explicit evidence-scope membership |
| GET | `/api/v2/operations/documents/:id/access` | ADMIN | Read the explicit evidence scope, holds and grants |
| POST | `/api/v2/operations/documents/:id/scope` | ADMIN | Change document sharing scope with an audit reason |
| POST | `/api/v2/operations/documents/:id/grant` | ADMIN | Grant or revoke one named user evidence access |
| POST | `/api/v2/operations/documents/:id/hold` | ADMIN | Set or release an evidence retention hold without deleting bytes |
| GET | `/api/v2/operations/documents/:id/dependencies` | ADMIN | Review evidence dependencies before any manual retention decision |
| POST | `/api/v2/operations/tasks/:id/reassign` | ADMIN | Transfer an open task without changing historical authorship |
| POST | `/api/v2/operations/sources/:id/reassign` | ADMIN | Transfer only source ownership; accounting identity stays immutable |
| POST | `/api/v2/operations/actions/:id/reassign` | ADMIN | Transfer responsibility for an open corrective action |
| GET | `/api/v2/operations/reassignments` | ADMIN | Page immutable operational transfer history |
| GET | `/api/v2/operations/notifications` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read your own in-app notification inbox |
| POST | `/api/v2/operations/notifications/:id/read` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Mark your own notification read |
| GET | `/api/v2/operations/preferences` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read your own notification preferences |
| POST | `/api/v2/operations/preferences` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Update your own reminder/email preferences |
| GET | `/api/v2/operations/outbox` | ADMIN | Page delivery statuses without exposing bodies or credential links |
| POST | `/api/v2/operations/exports` | ADMIN | Schedule a locked-period inventory export for independent approval |
| GET | `/api/v2/operations/exports` | ADMIN, REVIEWER, LEADERSHIP | Page background inventory export status |
| GET | `/api/v2/operations/exports/:id` | ADMIN, REVIEWER, LEADERSHIP | Read an export manifest and current period version |
| POST | `/api/v2/operations/exports/:id/review` | ADMIN, REVIEWER | Independently approve or reject a completed inventory export |
| GET | `/api/v2/operations/exports/:id/preview` | ADMIN, REVIEWER | Download exact bytes for review before publication |
| GET | `/api/v2/operations/exports/:id/download` | ADMIN, REVIEWER, LEADERSHIP | Download a hash-verified internally approved inventory export |
| POST | `/api/v2/operations/documents/:id/ocr` | ADMIN, ENTRY | Request bounded local English OCR on a clean unimported document |
| GET | `/api/v2/operations/ocr` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Page OCR runs visible to the uploader or university reviewer |

Public endpoints: `POST /api/v2/account/recover`, `POST /api/v2/account/complete`. Exact property shapes are in openapi.json.
