> Historical release reference (university v2.1). The current Scope 1/2 upgrade is documented in `../carbon/HLD.md`; its added methods and verification supersede earlier feature-limit statements. Original version is retained in `upgrade-backup/university-v2.1/`.

# CarbonSynq University Sustainability Suite - High-Level Design

Version 2.1.0-university-rc.1 | 2026-10-02 | Source-code release candidate

## 1. Decision and scope

The university extension is a modular addition to the existing `scale-api`, not a separate microservice or a new disconnected demo. It reuses the existing PostgreSQL tenant, users, sessions, campuses, periods, documents, audit events and durable invoice worker. The original root SQLite demo and original Neon repository remain separate, preserved applications. This release does not migrate those two applications' records into PostgreSQL.

The design implements university data collection, additional carbon activities, supplier engagement, exploratory materiality, reviewed inventory snapshots, reduction planning and optional product/project screening. It deliberately separates measured/approved facts from estimates, disclosures, questionnaires and planning. Unsupported connectors and AI features are reported as unavailable instead of being mocked in the application.

The original full scale-foundation HLD remains in `../HLD.md`. This document describes the additions and changed integration boundaries; `FEATURE-MATRIX.md` maps them to the user-supplied screenshots.

## 2. Implemented topology

```text
University staff / reviewer / leadership browsers
  | same-origin /university console and workflow studio
  | opaque session in Authorization header; memory only
  v
Existing Node HTTP API (/api/v2)
  | request/size/origin limits; authenticated tenant; request ID
  +--> existing Scope 1/2, administration, invoice services
  |
  +--> /api/v2/university router (85 authenticated operations)
        | role policy; strict allowed fields; versions; retry keys
        +-- collection service ----- assignments, revisions, evidence
        +-- emissions service ------ factors, CSV, calculation, voids
        +-- collaboration service -- suppliers, questionnaires, surveys
        +-- reporting service ------ combined view, snapshots, insights
        +-- planning service ------- baselines, targets, PCF screening
        |
        v
    UniversityStore: allowlisted SQL, parameterized values, tenant predicate
        |
        v
    PostgreSQL cs schema
      existing core tables + 19 u_* tables
      FORCE RLS / tenant composite foreign keys / immutable snapshots
      combined u_inventory + latest-approved u_current_metrics views

External supplier / stakeholder browser
  | /university/portal; one single-use capability pasted in memory
  v
2 capability-only endpoints -> IP/token rate limit -> hashed capability
  -> one tenant and one questionnaire/survey -> reviewed response only
  (no staff login, no inventory access, no automatic emissions posting)

Existing invoice path, reused:
Staff upload -> original private versioned object -> durable scan job
  -> separate worker + ClamAV adapter -> reviewable clean evidence
  -> evidence IDs referenced by collection and university carbon records
```

There is no LLM, vector database, automatic email, service-account connector or new distributed queue in this extension. The existing invoice queue remains database-backed. A university approval's bounded arithmetic runs inside its transaction, not in a new background calculation job. Reporting snapshots are synchronous and bounded, not infinitely scalable exports.

## 3. Module and file map

| File | Responsibility |
|---|---|
| `src/university/core.mjs` | Category/KPI catalogs, strict domain inputs, exact decimal helpers, CSV, questionnaire/survey/PCF rules |
| `store.mjs` | Tenant-scoped SQL repository, reference validation, evidence checks, paging, reporting reads and transaction boundary |
| `collection.mjs` | Departments, KPIs, assignments, drafts, revisions, review and waivers |
| `emissions.mjs` | Factor approvals, manual/CSV activities, category screening, exact calculation and correction/void workflows |
| `collaboration.mjs` | Supplier requests, capability invitations, survey collection and privacy-thresholded aggregates |
| `reporting.mjs` | Combined inventory, KPI aggregation, intensities, frozen reports, exports and deterministic insights |
| `planning.mjs` | Approved-baseline targets, comparable-period progress, initiatives and PCF screening |
| `router.mjs` | Executable operation/role/query metadata and dispatch |
| `migrations/002_university.sql` | New schema, references, indexes, security-invoker views, grants and immutability triggers |
| `public/university/*` | Responsive console, guided API request forms and external response portal |
| `scripts/build-university-docs.mjs` | OpenAPI/endpoint generation from executable routes and request schemas |

Integration changes are confined to the existing HTTP/static router, service wiring, period lock guard, migration runner, package/test commands, core navigation, Docker docs copy and CI. Previous bytes of modified original files are backed up. No dependency was added to `package.json`.

## 4. University data model

Every operational table below has `tenant_id`; relationships use tenant-aware foreign keys where relational references are applicable. Tenant identity is not accepted from university request bodies or queries.

| Entity | Purpose and invariant |
|---|---|
| `u_departments` | Campus-scoped department with accountable owner |
| `u_kpis` | Unique code, domain, unit, SUM/LATEST rule, evidence/range guidance |
| `u_tasks` | One source bucket and non-overlapping interval; distinct assignee/reviewer |
| `u_submissions` | Exact value, evidence and numbered revisions; one pending revision per task |
| `u_metric_snapshots` | Immutable approved metric, evidence metadata and reviewing actor |
| `u_factors` | Category, unit, method, exact factor, dated/versioned provenance and independent approval |
| `u_emissions` | Additional university carbon activity, source key, category/boundary, quality label and factor reference |
| `u_calculations` | One immutable result and provenance snapshot per activity |
| `u_voids` | Independently approved exclusion of a mistaken calculation; never deletes source history |
| `u_scope3_screenings` | All 15 categories can be INCLUDED, EXCLUDED or NOT_ASSESSED with rationale |
| `u_suppliers` | Tenant supplier reference and contact; no automatic outbound communication |
| `u_supplier_requests` | Typed questionnaire, supplier answers, staff evidence, review state |
| `u_materiality` | Topics, group survey design, thresholds and reviewed aggregate snapshot |
| `u_invites` | Token hash, target, expiry, consumed/revoked flags; token returned once only |
| `u_responses` | Immutable survey scores with stakeholder group; no respondent identity fields in published output |
| `u_reports` | Locked-period version, immutable JSON snapshot/hash and independent approval |
| `u_targets` | Approved report baseline, explicit scopes, absolute reduction percentage and owner |
| `u_initiatives` | Owner, dates, assumptions, estimated savings/cost and progress; not a carbon deduction |
| `u_pcf_studies` | Supplied BOM/process quantities, allocations, functional unit, reviewed screening result |

Invitation target references are polymorphic and are validated in application code, not by a polymorphic database foreign key. JSON structures are validated by the application; a privileged SQL writer can bypass many domain rules. The API must never run as the migration owner.

`u_current_metrics` selects the highest approved revision for each task. SUM indicators add non-overlapping source intervals. LATEST indicators retain the latest observation per campus/KPI/source bucket. Percentages are not added together; weighted totals need denominators. Campus-wide FTE/floor-area denominators must cover the complete reporting period and use a single `CAMPUS_TOTAL` source without a department. Annual reporting requires the institution to configure an annual reporting period.

## 5. Capture and approval lifecycle

### KPI capture

```text
ADMIN creates definition + task -> assigned contributor drafts a value
  -> submit with required clean evidence -> assigned reviewer/admin approval
  -> immutable metric snapshot -> approved indicator summary

Correction -> new numbered revision, explanation, new independent review
  -> previous snapshots retained; only latest approved revision is aggregated
```

Only a record's original author can edit its values. ADMIN cannot edit someone else's draft and then self-approve it. ADMIN can administer tasks, but cannot approve a submission they authored. A task's separate reviewer is checked for ordinary REVIEWER accounts. Rejected drafts remain repairable; open tasks block period closure. Waivers require an explanation and are visible in report snapshots.

A period/source/KPI advisory lock serializes overlapping assignment creation. Each mutation checks an expected version. Application-level interval checks are not a database exclusion constraint; real concurrent database testing is an acceptance gate.

### Carbon capture

The original Scope 1/2 workflow is preserved. The additional university workflow is:

```text
DRAFT -> SUBMITTED -> separate approval + exact calculation -> CALCULATED
                    \-> REJECTED -> author correction -> DRAFT

CALCULATED -> void requested -> another reviewer approves exclusion
            -> original record and calculation stay immutable
            -> optional replacement record links the original, in same period
```

A factor must already be independently approved, match the category/unit/date and match currency/base price-year when spend-based. For Scope 3, the category must be explicitly INCLUDED before calculation. Screening changes and approval share a category lock. A category with calculated records cannot be silently reclassified as excluded.

Human-review data quality is explicit: MEASURED, ESTIMATED or SPEND_PROXY. Estimates/proxies require assumptions. INR only works with an INR spend factor and explicit price year; it is never substituted for kWh, litres, kg or distance. There is no automatic FX/inflation correction. Human approval does not make supplier claims or estimates independently verified facts.

### CSV

`POST /imports/emissions/preview` validates at most 100 records / 50KB UTF-8 CSV without writes. `commit` revalidates all rows, then inserts reviewable drafts atomically. If any validation fails, no rows are committed. Retries require an idempotency key. Each row has a stable tenant-unique `externalKey` to prevent repeated source imports. This is not a universal semantic duplicate/fraud detection system across both ledgers.

## 6. Accounting boundaries and numerical policy

`kgCO2e = physical quantity x approved factor`, or explicitly labelled spend proxy x compatible spend factor. Decimal inputs are strings. BigInt arithmetic rounds half-up to 6 decimal kg CO2e; factors allow 9 decimal places. PostgreSQL NUMERIC holds exact snapshots. Display formatting may round values, but does not recalculate the ledger.

The primary view combines calculated original core Scope 1/2 rows with new university Scope 1/2/3 rows. Approved university voids are excluded. Student commuting/travel is supplemental in this application and displayed separately. PCF, project estimates, supplier answers and KPI observations never enter the primary inventory automatically. Existing core data quality is marked `UNCLASSIFIED_CORE`; the extension does not retroactively certify it.

Additional category support: refrigerant leakage, purchased heat/cooling, purchases/food/water, capital goods, upstream energy, upstream freight, waste/wastewater, business travel/hotels, employee commuting and upstream leased assets. All 15 Scope 3 categories have a screening register, but the activity calculators cover relevant categories 1-8; categories 9-15 require methodology-specific future extensions when applicable. Investment financed-emissions accounting is not implemented.

Avoid boundary overlap: an upstream-energy factor must exclude already-counted combustion/generation; a water factor must not overlap separately counted wastewater treatment; travel factors need the correct mode/basis; a refrigerant factor needs gas-specific GWP and a declared assessment basis. University factor approval is a governance decision. No authoritative factors are bundled as approved values.

An aggregate commuting estimate requires sampled participants, sample size, population, mode, one-way distance and days; it explicitly distinguishes passenger-km from vehicle-km and only divides by occupancy for vehicle-km. Population expansion is optional and labelled estimated. The estimator does not demonstrate survey representativeness.

## 7. Evidence, suppliers and materiality

New records reuse existing private document IDs. Each referenced document must belong to the tenant, have a stored object version, and be CLEAN/ready for review. Approval snapshots preserve hash/version/file metadata and a protected download reference. Existing tenant upload quota and scanner failure controls remain. A complete production evidence threat model must also include parser isolation, malware signature freshness, retention, encryption keys, access review and object-version recovery.

Supplier/stakeholder tokens are high entropy, hashed in the database, expiring, revocable and single-use. They appear once in the issuance response; that response is deliberately excluded from idempotency response caching. Losing it requires issuing/rotating an invitation. Tokens belong in `Authorization: Capability <token>`, never a URL. IP and token rate limits apply before the tenant-scoped response flow. There is no automatic email delivery.

The portal can only read its own questionnaire/survey and submit a typed response with attestation/consent. It cannot enumerate university records or upload files. Staff upload supplier evidence through the existing authenticated uploader, attach CLEAN evidence IDs, and request separate review. Answers do not become emissions until an authorized contributor creates a governed activity.

Materiality uses an explicitly exploratory unweighted mean of 1-5 ratings. Both impact and financial thresholds are configurable; a flagged topic is for human review, not an automated compliance ruling. Fewer than 5 total responses suppresses topic aggregates; small stakeholder-group counts and all free-text respondent rationale/IDs are withheld from the published summary. This is not formal differential privacy or guaranteed anonymity against an operator with database access. Do not collect sensitive personal data. The assessed population, sampling bias and legal applicability need separate human governance.

## 8. Reporting, planning and PCF

Report capture requires a locked period. A REPEATABLE READ transaction is opened before the first query, capturing the combined ledger, metric snapshots, evidence/factor provenance, Scope 3 coverage, task waivers and limitations. Independent report approval checks the captured period version is still locked/current. Snapshot content, hash and period version cannot be edited. A later reopened period marks an old report superseded; it does not silently update the published numbers. SHA-256 detects accidental snapshot changes, not tampering by a privileged operator who can alter both schema and hash.

Exports are JSON, formula-neutralized CSV and escaped print-ready HTML. No PDF/DOCX/XLSX engine or regulatory submission is implemented. Templates are internal inventory/ESG/university sustainability reports, not BRSR/CSRD/GRI/STARS accreditation or compliance assurance.

Report/metric capture is capped at 5000 rows, PCF at 100 lines. Larger carbon inventories can use paginated live inventory reads while the period remains locked, or need a separately engineered asynchronous reporting job. No tested university/user count, throughput, latency SLA or multi-region availability is claimed.

Targets reference an APPROVED immutable baseline report. Progress requires another APPROVED comparable snapshot: same declared boundary/campuses, non-overlapping later period and comparable duration. Otherwise change is unavailable. Campus-wide normalization similarly returns null when a denominator is missing/zero rather than implying zero intensity. Inventory changes do not prove causal reductions due to an initiative. Planned and completed project estimates are never subtracted from actual emissions.

PCF is an optional screening module for university research products, procurement or campus projects. The user supplies the BOM/process rows, physical-unit approved factors, life-cycle stages, explicit allocations and functional unit. Missing stages are exposed. A second reviewer approves the result. There is no generated BOM, full LCA validation, uncertainty analysis, EPD or ISO 14067 certification.

## 9. Traceable facts rather than simulated AI

The supported insight questions are EMISSIONS_SUMMARY, MISSING_SUBMISSIONS, TOP_HOTSPOTS, EVIDENCE_GAPS and SCOPE3_COVERAGE. Replies contain database-derived facts and source record references, with `engine: DETERMINISTIC_SQL_NOT_LLM`. The separate search endpoint performs bounded escaped lexical matching on approved university emissions and reports. It does not search arbitrary raw files or act as semantic retrieval.

No uploaded invoice text can instruct this system to execute an action. No LLM/OCR/model API is called. A future AI integration should require tenant-filtered retrieval, page/field source spans, explicit extraction uncertainty, injection-resistant tools, user approval for writes, model/data-processing contracts and independent evaluation. These are future requirements, not delivered capabilities.

## 10. Security and operational limits

The new operations use existing opaque sessions and revocation, server-derived tenant identity, parameterized SQL, explicit role checks, independent approval, RLS, compound references, transaction-local tenant settings, durable idempotency and audited mutations. The API role receives only SELECT/INSERT/UPDATE on new tables; immutable ledgers revoke UPDATE too. The worker receives no university-table grant. Security-invoker reporting views require PostgreSQL 15+; local Compose targets 17.

Existing core permissions are not silently replaced: they still permit their documented tenant-wide access. The university extension adds assignment/author restrictions to its own workflows, not a comprehensive department/campus ABAC policy. SSO/MFA, enterprise service accounts, granular campus roles, tenant-level business-row quotas, retention deletion, privacy review, billing, alerting and automatic reminders remain deployment/product work.

Operate behind reviewed TLS/origin settings, never publish the local Compose defaults to the Internet. Keep migration-owner credentials out of APIs. Generate/review a dependency lockfile and audit it; the delivery environment could not reach the registry and no lockfile is fabricated. Pin release image digests and scan images/dependencies before deployment. Back up database and versioned objects together, drill restoration and reconcile totals. Audit append-only triggers are not cryptographic tamper evidence.

## 11. Verification and acceptance

See `VERIFICATION.md` for actual executed results and `PRODUCTION-GATES.md` for unexecuted gates. Domain/HTTP/SQL-construction tests use explicit test doubles; they do not prove SQL syntax, runtime RLS, transactions or concurrency against PostgreSQL. The real database suite and CI steps are included but have not been executed in this environment. UI checks used a synthetic DOM/local-HTTP harness because native browser navigation was blocked; native navigation, production CSP and live database-driven browser flows remain unverified.

## 12. Primary references and interpretation limits

Checked 2026-10-02. These inform design terminology; none certify this application.

- AASHE STARS higher-education topic index: https://stars.aashe.org/resources-support/technical-manual/
- GHG Protocol Scope 3 calculation guidance: https://ghgprotocol.org/scope-3-calculation-guidance-2
- GHG Protocol category 7: https://ghgprotocol.org/sites/default/files/standards_supporting/Chapter7.pdf
- PostgreSQL 17 row security: https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- PostgreSQL 17 CREATE VIEW / security_invoker: https://www.postgresql.org/docs/17/sql-createview.html

The student supplemental classification is a conservative application choice requiring institutional approval, not a universal interpretation of every reporting standard. KPI overlap with STARS subject areas is not STARS credit calculation. No claim is made that a corporate disclosure framework in the screenshots applies to this university.
