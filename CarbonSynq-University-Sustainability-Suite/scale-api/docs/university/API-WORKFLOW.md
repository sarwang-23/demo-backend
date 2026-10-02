# University API and rehearsal workflow

Version 2.1.0-university-rc.1. All identifiers below must come from YOUR authenticated university. Use an isolated rehearsal tenant for invented demonstration data. Do not mix demonstration factors or records with a university's real inventory.

## 1. Authentication and references

Start the stack using README-UNIVERSITY-FIRST.md. `POST /api/v2/auth/login` accepts `{tenantId,email,password}` and returns `data.token`. Use `Authorization: Bearer <token>` for staff API calls. Tokens are not interchangeable between administrator, contributor and reviewer. Log in separately as the reviewer for approvals. Reusing an administrator's session does not constitute an independent review.

Read `GET /api/v2/university/meta` for available campuses, periods, departments, KPIs and factors. An administrator also sees user references. For more than 100 records, follow the resource's paginated listing rather than treating the first reference-data page as a full directory. The existing core console at `/` supports users, campuses, reporting periods and invoice workflows. The new university console is `/university`.

Use `POST /api/v2/university/catalog/install` with `{}` as administrator to install 22 KPI definitions. This creates no measurements and no emission factors. Calling it again does not duplicate definitions. Register a department with its campus and existing owner when departmental collection is needed.

## 2. KPI assignment -> original evidence -> independent review

Create a task as administrator with `periodId`, `campusId`, `kpiId`, `assigneeId`, `reviewerId`, `bucket`, `intervalStart`, `intervalEnd` and `dueDate`. `departmentId` is optional. The assignee must be ADMIN or ENTRY; the reviewer must be ADMIN or REVIEWER and must be a different user. `bucket` identifies a source such as a specific meter. Overlapping intervals for the same source/KPI/campus/period are rejected; changing the bucket is not a legitimate way to enter the same source twice.

Upload the original evidence through the existing private-document API or Evidence screen. Wait for the actual scan result. A metadata row alone or an uploaded file that is still scanning does not count as clean evidence. Scanner failure must be resolved, not bypassed. An invoice amount in rupees is not a kWh, water-volume or fuel-consumption reading.

As the assignee, call `POST /api/v2/university/tasks/:id/submissions` with `taskVersion`, a decimal-string `value`, exact `unit`, `notes` and `evidenceIds`. Read returned versions after every transition. Submit with `POST .../submissions/:id/submit`, body `{version}`. The assigned separate reviewer then calls `POST .../submissions/:id/approve`, body `{version}`. A rejection additionally needs a reason. Approved values appear in the university overview. Corrections are new revisions with `correctionReason`; historical approved snapshots remain.

Normalization KPIs (student FTE, staff FTE and floor area) use one campus-total, whole-period task without a department. Do not add monthly headcounts or percentages together. KPI records are not carbon postings; energy and water observations do not silently duplicate emissions.

## 3. Additional Scope 1/2 and Scope 3 activities

Use `/catalog` for supported category/unit combinations. The existing core activity workflow remains the path for its electricity/fuel categories. Do not post the same consumption a second time in a different ledger.

An administrator creates a university factor at `POST /factors` with category, unit, exact value, method, source name, HTTPS source URL, region, boundary, version label and date validity. A separate reviewer approves it using `POST /factors/:id/approve`. Real reporting needs an applicable, documented factor; software approval is not independent certification of the source. Physical factors and spend-based factors are different methods. Spend-based records require an INR factor with the same price year; there is no automatic currency conversion or inflation adjustment.

For Scope 3, record inclusion decisions and rationale at `POST /scope3-screenings`. All 15 categories can be screened, but the release implements only the listed university-relevant calculation categories. Unassessed or excluded categories are not zero emissions. Student commuting/travel is a separately displayed supplemental boundary in this product, not silently assigned to employee commuting.

Create a draft at `POST /emissions` with the fields shown in requests.http. Quantity must be a decimal string. Preserve a stable `externalKey` from the source system or source document line. Add assumptions for estimates and spend proxies. Submit, then have a separate reviewer approve. Approval validates the factor and clean evidence and atomically creates one calculation snapshot. Repeated HTTP retries should reuse the original Idempotency-Key; changed content must use a new key. Drafts and rejected records do not enter totals.

Bulk input uses `POST /imports/emissions/preview` and `/commit`, with the CSV string and fields defined by the OpenAPI schema. Maximum 100 rows and 50 KB of CSV per request; preview writes nothing and commit creates drafts atomically. Native Excel files are not accepted. A failed row does not partly commit the batch. For approved mistakes, request and separately approve a void, then create a replacement linked with `replacesId`; never overwrite or delete the original calculation.

## 4. Supplier questionnaires and stakeholder surveys

Create a supplier and a typed supplier request. Issue a capability through `POST /supplier-requests/:id/invite`. The response contains a token ONCE: deliver it privately using the university's approved channel. No email is sent. The external user opens `/university/portal` and pastes the token. API clients use `Authorization: Capability <token>`, never a URL query token or staff session.

Supplier answers require attestation and are reviewable, not automatically accepted emissions. Suppliers cannot upload files through the portal. Staff upload and link clean evidence, then a different reviewer approves. Rotating a supplier invitation invalidates earlier invitations.

Materiality assessments define topics and exploratory impact/financial thresholds. Issue one invitation per stakeholder, with an appropriate group. Participation requires consent. Do not request student IDs or sensitive personal details. The minimum response threshold is at least five; small groups are suppressed. Close, review and publish aggregate results. This is an exploratory prioritization survey, not an automatic statutory double-materiality assessment or a representative-sampling guarantee.

## 5. Frozen reporting, reduction targets and optional PCF

Complete or legitimately waive all collection tasks, resolve pending carbon records and voids, then lock the reporting period using the core `POST /api/v2/periods/:id/lock` endpoint with the latest period version and reason. A final university report requires a locked period. Create it at `POST /reports`, declare its boundary, and obtain independent approval. Export `GET /reports/:id/export?format=json`, `csv` or `html`. HTML is printable; the backend does not generate a native PDF, DOCX or XLSX. Report snapshots carry their data, evidence/factor provenance and integrity hash. A reopened period makes an old report visibly historical; it does not silently rewrite it.

Targets use an APPROVED baseline report, selected primary scopes, reduction percent, target date and owner. Progress compares an approved current report with a compatible boundary/campus set and comparable non-overlapping period. Planned initiatives track estimated savings and progress but never reduce the actual inventory. An activity marked complete is not evidence of achieved carbon savings.

PCF studies are optional physical-factor, functional-unit/BOM screening calculations. Enter allocation assumptions and omitted life-cycle stages explicitly. Review them separately. They are not added to the university inventory and are not an ISO-compliant LCA, verified EPD or certified product footprint.

## 6. Traceable insights and university overview

`POST /insights/query` accepts `periodId` and one supported `questionId`: EMISSIONS_SUMMARY, MISSING_SUBMISSIONS, TOP_HOTSPOTS, EVIDENCE_GAPS or SCOPE3_COVERAGE. Results are deterministic database facts with source-record references, not LLM-written answers. Approved-record search is lexical. There is no autonomous SQL agent, OCR provider, ERP sync or IoT integration in this release.

The university overview combines the existing core calculated ledger with the new approved university calculations. Supplemental student travel, KPIs, planning estimates and PCF remain separate. The old core dashboard retains its original scope and is not relabelled as a complete Scope 3 dashboard.

## Errors, versions and safe retries

401: missing/expired authentication; 403: permission or maker-checker failure; 404: missing/inaccessible record; 409: duplicate, stale version, locked period or invalid workflow; 422: invalid units, fields, assumptions, evidence or factor applicability; 429: rate limit. Handle the machine-readable error code, retain the request ID, and do not hide an error behind a fabricated success message. Refresh the record after a version conflict and review the new state before retrying.

The complete machine-readable contract is `openapi.json`; the `.http` examples deliberately use placeholders. The acceptance suite in `tests/university/postgres.integration.mjs` shows an integrated workflow but must run only against a disposable database ending in `_test`. Its real database execution was not performed for this delivery.
