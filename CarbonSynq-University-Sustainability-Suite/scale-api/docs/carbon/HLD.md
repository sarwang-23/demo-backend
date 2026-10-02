# CarbonSynq University - Enhanced Scope 1 and Scope 2 HLD

Version **2.2.0-scope12-rc.1** | Delivery: **2026-10-02** | Status: **release candidate; infrastructure acceptance outstanding**.

## 1. What this upgrade changes

This is an integrated extension of the supplied PostgreSQL `scale-api`, not another disconnected demo. The earlier university ESG collection, Scope 3, supplier, materiality, targets, report and PCF modules remain. The root SQLite demonstration and original Neon repository remain in the ZIP as historical, separate implementations.

The upgrade adds 49 authenticated operations, ten PostgreSQL tables, a Scope 1 & 2 console section, ten optional KPI definitions and independently reviewed source accounting. It addresses missing controls in the previous release: fuel consumption versus fuel purchased, refrigerant loss versus refrigerant purchased, gas/GWP provenance, gross electricity imports, location/market alternatives, energy attribute evidence, date coverage, correction history and report readiness.

**This is not a claim that every possible university process or regulation is implemented.** Operational boundaries, official factors and contractual eligibility require competent review. Public production deployment, live PostgreSQL/RLS, S3, ClamAV, load and recovery acceptance are not verified by the local test results.

## 2. Deployed component design

```text
University console / existing API clients
  | /api/v2/university/carbon/* (same authenticated application)
  v
Existing Node HTTP layer
  body limits -> session authentication -> role check -> request validation
  -> tenant transaction -> idempotency -> university dispatcher
       |
       +-- carbon/catalog.mjs: supported source shapes, checklist, KPI definitions
       +-- carbon/core.mjs: decimal math, quantity methods, factor/instrument rules
       +-- carbon/service.mjs: source, boundary, approval, allocation, correction
       +-- carbon/reporting.mjs: coverage, alternatives, snapshot, export
       +-- carbon/routes.mjs: 49 real authenticated API operations
       |
       v
UniversityStore -> PostgreSQL with tenant RLS + composite tenant references
  | sources / boundary versions / immutable factor versions
  | records / immutable calculations / allocations / approved voids
  | corrective actions / exclusive period mode
  |
  +-- u_inventory: Scope 1 + LOCATION Scope 2 + existing Scope 3
  +-- frozen reports: both Scope 2 alternatives + full provenance
  +-- targets: explicitly fixed LOCATION or MARKET basis

Existing document flow, unchanged architecture:
private versioned S3 -> durable queue -> ClamAV/parser worker
 -> staff review -> evidence ID -> source record / boundary / instrument
```

There is no added external AI service, paid factor database or registry connection. The existing API/worker separation is retained. Enhanced carbon arithmetic is deterministic synchronous application code. The worker is not given general access to the new operational tables; it can read the period-mode table for the legacy-write guard.

## 3. University source register and organizational boundary

A source identifies a physical or operational accounting stream: boiler fuel, a fleet fuel account, a chiller refrigerant system, an electricity import meter or a purchased thermal-energy stream. It includes university, campus, optional building/department, assigned entry owner, unique code, facility type, source kind, substance, canonical unit, geography and active dates. Source definitions are immutable in this release.

Facility types cover academic buildings, laboratories, hostels, dining, hospitals, sports, data centres, administration, farms, leased facilities and other sites. Supported boundary approaches are **operational control** and **financial control**; equity-share accounting is not implemented. Ownership or control is not inferred from the word 'campus'. Contracted buses, leased premises and third-party energy must be assessed under the selected organizational boundary.

An administrator drafts a period boundary that includes or explicitly excludes every registered campus, assesses every active registered source in included campuses, declares a base year and recalculation policy, and chooses DUAL or LOCATION_ONLY Scope 2 reporting with a rationale. Source decisions are INCLUDED, EXCLUDED or NO_ACTIVITY. No-activity declarations require evidence, not a silent zero. A separate reviewer approves the boundary.

Each included campus must complete eight screening items: generators/boilers/kitchens; owned/controlled fleet; AC/chillers; laboratory/clinical/electrical gas releases; campus processes; grid/landlord/PPA electricity; district energy; and solar/attribute ownership. Present categories require a corresponding source. An excluded source needs a reason. This is an internal completeness control, not proof that an unregistered source does not exist.

The source snapshot is frozen into the approved boundary. Sources registered afterwards are flagged as unassessed. A new boundary cannot reinterpret active entries; resolve or independently void those entries before approving a revised boundary. A pending boundary draft blocks final readiness. Source definitions currently cannot be edited or retired in place; plan active dates carefully and use an explicitly reviewed version/new source when appropriate. There is no automatic historical source migration.

## 4. Exclusive Scope 1/2 period mode

The new source ledger and old Scope 1/2 ledgers must not be used in parallel for the same period. Approving the first enhanced boundary activates an immutable period-mode row. Activation is rejected while non-rejected old core activity or old university Scope 1/2 records exist. Existing Scope 3 and supplemental entries may coexist.

Application guards explain the conflict. PostgreSQL triggers guard both old-ledger writes and mode activation, using the same tenant/period advisory-lock key. Activation and legacy insert races are covered by a supplied real-PostgreSQL acceptance suite, but that suite was not run in this environment.

Old records are not deleted, renumbered, reclassified or marked as enhanced retrospectively. Use a clean period for rehearsal or produce a reviewed reconciliation/migration plan for an existing live inventory. Do not run both ledgers and manually sum them. Rejected legacy records are history only; after activation their old routes cannot be repurposed into new Scope 1/2 entries.

## 5. Scope 1 methods

| Source kind | Implemented capture and calculation | Important boundary |
| --- | --- | --- |
| STATIONARY_COMBUSTION | DG, boilers, dining LPG and other controlled fuel use; direct consumption, tank/stock reconciliation or meter readings | Fuel purchases do not automatically equal consumption. No vehicle/process fuel is counted twice under a separate stationary account. |
| MOBILE_COMBUSTION | Controlled buses, cars, ambulances and grounds equipment; actual fuel consumed | Distance-to-fuel modelling and outsourced transport categorization are not inferred. |
| REFRIGERANT | Direct documented loss, stock/equipment mass balance or explicitly attested service top-up for leak replacement | New equipment charge and purchased cylinders are not automatically emissions. |
| DIRECT_GAS | Documented mass released of a named GHG, with matching reviewed 100-year GWP | Not every clinical or laboratory gas is a reportable GHG; its eligibility must be reviewed. |
| ONSITE_PROCESS | Documented activity multiplied by reviewed gas-specific or aggregate process factors | General method support, not full wastewater, livestock, soil, fertilizer or land-sector modelling. |

Disaggregated factors preserve gas mass, GWP and resulting CO2e for each gas. A combustion factor must contain CO2 or separately disclosed biogenic CO2 and the CH4/N2O components, unless an explicitly documented aggregate all-gas CO2e factor is supplied. Aggregate factors are labelled as such and do not create a fabricated gas breakdown. Refrigerant/direct-gas factors match the exact named gas and use mass-per-unit one.

`CO2_BIOGENIC` mass is disclosed separately from primary inventory CO2e. Biogenic combustion CH4 and N2O remain in Scope 1. An aggregate CO2e factor cannot reconstruct a missing biogenic CO2 disclosure; select reviewed gas components when that disclosure is needed.

No official GWP values, grid factors or fuel factors are automatically seeded. Every factor has source URL, source description, region, applicability dates, accounting boundary, version label, GWP basis and separate approval. Approved factors are immutable. The UI example templates deliberately do not pre-approve factors or substitute a demo number as a real factor.

## 6. Quantity reconciliation

`POST /carbon/quantity/preview` is non-persistent. Record preview additionally checks the selected source, boundary and factors without reserving a certificate or interval.

| Mode | Formula / invariant |
| --- | --- |
| DIRECT | Documented nonnegative quantity in the source's canonical unit. |
| FUEL_STOCK | Opening + receipts + transfers in - closing - transfers out. Negative results are rejected, not clipped. |
| METER | (Closing - opening + one explicitly documented rollover where applicable) x multiplier. Multiplier must be positive. |
| REFRIGERANT_BALANCE | Opening equipment charge + opening inventory + acquired - closing equipment charge - closing inventory - transferred out. Inputs must describe the same accounting boundary. |
| SERVICE_TOPUP | Only a documented replacement of leaked refrigerant, with explicit attestation. |
| ENERGY_CONVERSION | MWh x 1,000 or GJ x 2,500/9 to delivered kWh. |
| ELECTRICITY_BALANCE | Imported kWh is the emission-bearing purchased-energy quantity. Imports + on-site generation - exports is informational campus use, not a net-import credit. |

Invoice currency never becomes a physical quantity. Steam mass without delivered energy or a separately reviewed conversion is not accepted as kWh. Refrigerant volume is not silently treated as kg. Every zero record needs an explanation. Estimated records need disclosed assumptions and are shown as estimates.

Quantities use six decimal places; factor/GWP inputs use nine; resulting emissions use six, calculated with BigInt-scaled decimal arithmetic rather than binary floating point. Rounding occurs at documented conversion/calculation boundaries. Large values beyond the supported numeric bounds are rejected. UI summary cards may round for presentation; record and export values retain precision.

## 7. Scope 2 dual reporting and renewable evidence

The energy source types are purchased electricity, steam, heat and cooling, with delivered energy normalized to kWh. A specialist-reviewed attribute-replacement electricity source supports accounting where attributes from consumed self-generation were sold; it is not automatically created from a solar meter.

Every calculated Scope 2 record has an approved generation-boundary LOCATION factor. In a DUAL period it also has market allocations and/or an eligible unmatched-energy fallback. LOCATION_ONLY periods publish no market-based claim. Applicability of dual reporting is a reviewed boundary decision, not detected from the user's location.

```text
location kgCO2e = gross purchased quantity x approved location factor
market kgCO2e   = sum(eligible allocated kWh x contract factor)
                 + unmatched kWh x approved fallback factor
primary inventory = Scope 1 + LOCATION Scope 2 + existing primary Scope 3
```

Market-based results are an alternative. They are never added to location-based results. The dashboard and frozen report show both, and fixed-basis targets use one explicitly selected method. The main university inventory remains location-based for backward compatibility.

An energy instrument stores EAC/PPA/supplier-product type, registry reference, normalized serial, exact university beneficiary, geography, applicable period, quantity, vintage, retirement date, factor, evidence and eight structured review assessments. Criteria reflect the intake questions needed for attribute claims but are **not an automated legal or full GHG Protocol eligibility determination**. Some criteria permit a reasoned not-applicable assessment; core ownership/vintage/market criteria must pass. A PPA label alone cannot produce zero emissions. Zero factors require an explanation and independent approval.

The application rejects duplicate normalized serials within a tenant, invalid dates/beneficiary, wrong geography/commodity, allocations beyond source consumption, and consumption beyond approved instrument capacity. Capacity is rechecked under the period lock at final approval, not promised by previews or drafts. Approval atomically stores allocation and calculation. All instruments are period-scoped, so a corrected allocation can only be reused within that same reporting period.

Unmatched consumption cannot silently become zero. Prefer a matching approved RESIDUAL factor; GRID_FALLBACK requires a recorded rationale and is rejected if a covering approved residual factor is present in the local catalog. External residual-mix availability and claimed inapplicability still require human research; the software cannot verify an absent catalog entry against the world.

No external registry is queried. Cross-tenant/global double claims, certificate fraud, hourly matching and proprietary supplier methodology are not automatically established. Gross imports, exports, self-generation and retained/sold attributes remain separate data; electricity exports are not subtracted as an avoided-emissions credit.

## 8. Workflow, correction and transactions

```text
source registration + approved boundary + approved factor versions
    -> DRAFT -> SUBMITTED -> CALCULATED (independent reviewer)
          ^       |
          |       +-> REJECTED -> correction -> DRAFT
          +-> CANCELLED (explicit withdrawal)

CALCULATED -> requested void -> independent approve/reject
             approved void excludes the old result from active totals
             -> optional new record linked with replacesId
```

The entry author cannot approve their own record, including when using an administrator role. Similar maker-checker controls govern factors, boundaries, instruments and voids. Version checks reject stale writes. Source owners restrict entry access. Leadership is read-only. Evidence refers to clean, stored, tenant-owned documents through the existing ingestion service; no new public bucket or unrestricted download is introduced.

A mutation runs inside the existing tenant transaction and idempotency wrapper. Source intervals, external keys, capacity, workflow, calculation, audit and allocation are checked/committed atomically. Period-scoped advisory locks serialize enhanced mutations. These controls are designed for multiple API processes sharing PostgreSQL; their real multi-process acceptance is pending.

A void does not delete the record, calculation or certificate allocations. Active views omit approved voids, and active allocation consumption excludes them. Replacement links preserve the chain. A pending correction remains in active inventory until approved and blocks a final report. A locked period must be reopened through existing audited controls before correction; previously frozen reports stay immutable and are visibly superseded by period changes.

Duplicate interval detection is per registered source within a reporting period. It does not identify two differently named sources as the same physical meter, resolve parent/submeter overlap or reconcile overlapping academic/calendar-year inventories. The boundary reviewer must select the correct measurement hierarchy. EV submeter KPIs are informational and are not automatically added to main-meter purchased electricity.

## 9. Data model

| New table | Responsibility |
| --- | --- |
| u_c_sources | Immutable tenant/campus source and owner. |
| u_c_boundaries | Draft/reviewed boundary versions with campus decisions, source snapshots, screening, base year and Scope 2 mode. |
| u_c_period_modes | Immutable exclusive enhanced-ledger activation. |
| u_c_factors | Independently approved gas/component and energy-factor versions. |
| u_c_instruments | Reviewed period-specific contractual attribute evidence. |
| u_c_records | Quantity inputs, interval, source, quality, factors, evidence, workflow and replacement reference. |
| u_c_calculations | One immutable result/provenance snapshot per calculated record; Scope 1, location, market, biogenic columns. |
| u_c_allocations | Immutable record/instrument energy allocation facts. |
| u_c_voids | Independently reviewed logical correction history. |
| u_c_actions | Campus corrective actions, severity, owner, deadline, resolution and separate closure. |

Migration `003_scope12.sql` adds forced tenant RLS, composite tenant foreign keys, workflow checks, indexes and immutable triggers. It adds `u_targets.scope2_basis`, creates a security-invoker active carbon view, and extends `u_inventory` without changing its existing column contract. Migrations 001 and 002 remain byte-for-byte unchanged. RLS is a defense-in-depth control; a privileged database owner can still change schema/data, and deployment must not use owner credentials for API requests.

## 10. Missing-data control and university follow-up

Readiness checks every INCLUDED source over its active dates in the period. It reports exact uncovered date intervals, pending drafts/submissions/rejections, unassessed new sources, pending boundary review and pending voids. Review frequency is recorded as metadata; readiness enforces continuous declared date coverage, not a universal mandatory monthly cadence. A reviewed NO_ACTIVITY declaration is distinguishable from missing data.

Corrective actions have campus/source, owner, severity, due date, description and evidence. The owner resolves; a separate reviewer closes. HIGH/CRITICAL unresolved findings block period locking and final reporting. Lower findings remain visible warnings. There is no email/reminder scheduler in this extension; due/overdue values are returned to the UI.

The ten optional KPI definitions cover exports, self-used solar, EV charging, closing diesel stock, DG hours, recovered refrigerant, completed calibrations, completed energy-audit actions, biodiversity-managed area and harvested rainwater. Their installer is idempotent and creates definitions only. Together with the existing 22 definitions the workspace can install 32; these are a starter catalog, not full STARS/BRSR requirements. Meter calibrations are an aggregate KPI, not a full equipment-maintenance system.

## 11. Reporting, target consistency and traceability

Only active calculated records enter emissions totals. KPI values, drafts, submitted entries, supplemental student travel, PCF studies and initiative estimates remain separate. The primary view includes enhanced Scope 1 or location-based Scope 2 exactly once. Main inventory insights now link enhanced records to their correct `/carbon/records/:id` endpoint.

The period lock guard and frozen report creation require enhanced readiness. The report snapshot includes the declared boundary, both Scope 2 alternatives, separate biogenic CO2, factor/GWP/evidence provenance, source coverage and limitations. Independently approved reports export JSON, CSV and printable HTML. Enhanced CSV appends alternative columns without replacing the legacy primary column or adding duplicate rows. Old snapshots still export on their old contract. There is no server-side DOCX/PDF renderer or automatic disclosure certification.

Targets store a fixed LOCATION or MARKET basis. Market-based targets require a complete enhanced dual-reporting baseline and comparable later report. Progress uses immutable report results, not a sum of proposed project savings. The selected boundary, period length and campus comparability are checked, but causality and base-year recalculation governance are still human responsibilities.

## 12. API, security and operational limits

See `openapi.json` for the 49 new operations and `../university/openapi.json` for all 136 university operations (134 staff + two existing capability-portal operations). New endpoints reuse bearer-session authentication, existing security headers, rate limits, errors, request IDs and idempotency. Mutating clients must send a fresh stable `Idempotency-Key` for a logical operation and the current `version` for transitions; retry the same body/key only when retrying that operation.

Carbon sources are tenant scoped; entry users see their owned sources and authored records. Reviewer/admin/leadership can inspect the relevant tenant ledgers; this release does not implement a fully configurable campus-scoped ABAC policy for all roles. Tenant isolation is not a substitute for data-minimization review of sensitive university documents.

Limits are deliberately bounded: 200 sources per approved boundary, 5,000 records per period, 20 instrument allocations per record, 1,000 instruments per period, JSON request limits inherited from the API, and CSV max 100 rows/50 KB. CSV commit is one-period atomic and creates drafts only. Batch certificate splits use the JSON API, not direct-quantity CSV. Synchronous report snapshots and per-period serialization are not unbounded enterprise-throughput claims.

The UI fetches a bounded reference list and displays a notice for larger catalogs; clients should use paginated APIs for larger selection workflows. Rich source/factor/boundary forms retain a guided JSON editor for advanced fields. Native navigation/CSP and real-browser-to-PostgreSQL end-to-end testing remain production gates.

## 13. Release verification and known omissions

The delivered verification records distinguish exact-decimal/unit/domain/HTTP tests from real integration. Memory-backed domain tests do not execute PostgreSQL constraints or RLS. UI checks use real Chromium rendering plus a loopback HTTP bridge because native navigation is blocked in this environment; they are not native navigation/CSP tests. See `VERIFICATION.md` and bundled QA evidence for actual counts.

Still not implemented/connected: university SSO/MFA, AI OCR, automatic official factors, external EAC registries, ERP/IoT, automatic email, full farm/land/wastewater calculation suites, plant CHP allocation, complete steam enthalpy engineering, billing, native disclosure certification, automated migration of legacy Scope 1/2 histories and cryptographic audit tamper evidence. Original Neon compilation/deployment is not part of this release's test claim.

Before live customers, execute `PRODUCTION-GATES.md`: real migrations, RLS/role adversarial tests, concurrent capacity/activation tests, parser/scanner quarantine, S3 policy/version checks, restore drills, dependency/image audit, public TLS/session controls, native UI regression, representative load and factor/methodology acceptance.

## 14. Source basis and change governance

Primary technical references checked for this delivery are recorded in `SOURCES.md`. The accounting baseline is the Corporate Standard and Scope 2 Guidance (2015); consultation proposals are not silently promoted to current implementation rules. The factor source/version and the boundary statement are part of every calculation context. This software is not endorsed by GHG Protocol or AASHE, and an internal approval does not confer external assurance.
