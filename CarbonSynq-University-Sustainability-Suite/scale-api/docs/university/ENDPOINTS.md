# University API operations

151 authenticated operations plus two capability-only portal operations. Existing /api/v2 authentication and evidence endpoints remain available.

| Method | Path | Roles | Purpose |
|---|---|---|---|
| GET | `/api/v2/university/catalog` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read supported university categories, KPI templates and capabilities |
| POST | `/api/v2/university/catalog/install` | ADMIN | Install KPI definitions without seeding measurements |
| GET | `/api/v2/university/meta` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Load the first reference-data pages for the university console |
| GET | `/api/v2/university/overview` | ADMIN, REVIEWER, LEADERSHIP | Read combined inventory and approved university indicators |
| GET | `/api/v2/university/inventory` | ADMIN, REVIEWER, LEADERSHIP | Page the combined primary and supplemental inventory |
| GET | `/api/v2/university/knowledge/search` | ADMIN, REVIEWER, LEADERSHIP | Search approved university records without an AI model |
| POST | `/api/v2/university/insights/query` | ADMIN, REVIEWER, LEADERSHIP | Return traceable facts for a supported insight question |
| POST | `/api/v2/university/commuting/estimate` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Estimate aggregate commuting distance with explicit assumptions |
| GET | `/api/v2/university/departments` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List departments with tenant-scoped keyset pagination |
| GET | `/api/v2/university/departments/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read departments record |
| POST | `/api/v2/university/departments` | ADMIN | Create departments record |
| GET | `/api/v2/university/kpis` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List kpis with tenant-scoped keyset pagination |
| GET | `/api/v2/university/kpis/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read kpis record |
| POST | `/api/v2/university/kpis` | ADMIN | Create kpis record |
| GET | `/api/v2/university/tasks` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List tasks with tenant-scoped keyset pagination |
| GET | `/api/v2/university/tasks/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read tasks record |
| POST | `/api/v2/university/tasks` | ADMIN | Create tasks record |
| GET | `/api/v2/university/factors` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List factors with tenant-scoped keyset pagination |
| GET | `/api/v2/university/factors/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read factors record |
| POST | `/api/v2/university/factors` | ADMIN | Create factors record |
| GET | `/api/v2/university/emissions` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List emissions with tenant-scoped keyset pagination |
| GET | `/api/v2/university/emissions/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read emissions record |
| POST | `/api/v2/university/emissions` | ADMIN, ENTRY | Create emissions record |
| GET | `/api/v2/university/scope3-screenings` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List scope3-screenings with tenant-scoped keyset pagination |
| GET | `/api/v2/university/scope3-screenings/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read scope3-screenings record |
| POST | `/api/v2/university/scope3-screenings` | ADMIN | Create scope3-screenings record |
| GET | `/api/v2/university/suppliers` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List suppliers with tenant-scoped keyset pagination |
| GET | `/api/v2/university/suppliers/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read suppliers record |
| POST | `/api/v2/university/suppliers` | ADMIN, ENTRY | Create suppliers record |
| GET | `/api/v2/university/supplier-requests` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List supplier-requests with tenant-scoped keyset pagination |
| GET | `/api/v2/university/supplier-requests/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read supplier-requests record |
| POST | `/api/v2/university/supplier-requests` | ADMIN, ENTRY | Create supplier-requests record |
| GET | `/api/v2/university/materiality` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List materiality with tenant-scoped keyset pagination |
| GET | `/api/v2/university/materiality/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read materiality record |
| POST | `/api/v2/university/materiality` | ADMIN, ENTRY | Create materiality record |
| GET | `/api/v2/university/reports` | ADMIN, REVIEWER, LEADERSHIP | List reports with tenant-scoped keyset pagination |
| GET | `/api/v2/university/reports/:id` | ADMIN, REVIEWER, LEADERSHIP | Read reports record |
| POST | `/api/v2/university/reports` | ADMIN | Create reports record |
| GET | `/api/v2/university/targets` | ADMIN, REVIEWER, LEADERSHIP | List targets with tenant-scoped keyset pagination |
| GET | `/api/v2/university/targets/:id` | ADMIN, REVIEWER, LEADERSHIP | Read targets record |
| POST | `/api/v2/university/targets` | ADMIN | Create targets record |
| GET | `/api/v2/university/initiatives` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List initiatives with tenant-scoped keyset pagination |
| GET | `/api/v2/university/initiatives/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read initiatives record |
| POST | `/api/v2/university/initiatives` | ADMIN | Create initiatives record |
| GET | `/api/v2/university/pcf-studies` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List pcf-studies with tenant-scoped keyset pagination |
| GET | `/api/v2/university/pcf-studies/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read pcf-studies record |
| POST | `/api/v2/university/pcf-studies` | ADMIN, ENTRY | Create pcf-studies record |
| GET | `/api/v2/university/voids` | ADMIN, REVIEWER, LEADERSHIP | List voids with tenant-scoped keyset pagination |
| GET | `/api/v2/university/voids/:id` | ADMIN, REVIEWER, LEADERSHIP | Read voids record |
| POST | `/api/v2/university/tasks/:id/submissions` | ADMIN, ENTRY | Save an assigned KPI draft or corrected revision |
| POST | `/api/v2/university/tasks/:id/waive` | ADMIN | Waive a collection task with a recorded reason |
| GET | `/api/v2/university/submissions/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read an authorized collection submission |
| PATCH | `/api/v2/university/submissions/:id` | ADMIN, ENTRY | Edit your draft or rejected collection submission |
| POST | `/api/v2/university/submissions/:id/submit` | ADMIN, ENTRY | submit KPI submission |
| POST | `/api/v2/university/submissions/:id/approve` | ADMIN, REVIEWER | approve KPI submission |
| POST | `/api/v2/university/submissions/:id/reject` | ADMIN, REVIEWER | reject KPI submission |
| POST | `/api/v2/university/factors/:id/approve` | ADMIN, REVIEWER | Independently approve and freeze a university factor |
| PATCH | `/api/v2/university/emissions/:id` | ADMIN, ENTRY | Edit your draft or rejected university emission record |
| POST | `/api/v2/university/emissions/:id/submit` | ADMIN, ENTRY | submit university emission record |
| POST | `/api/v2/university/emissions/:id/approve` | ADMIN, REVIEWER | approve university emission record |
| POST | `/api/v2/university/emissions/:id/reject` | ADMIN, REVIEWER | reject university emission record |
| POST | `/api/v2/university/emissions/:id/request-void` | ADMIN, ENTRY | Request a traceable correction without deleting a calculation |
| POST | `/api/v2/university/voids/:id/approve` | ADMIN, REVIEWER | approve inventory void |
| POST | `/api/v2/university/voids/:id/reject` | ADMIN, REVIEWER | reject inventory void |
| POST | `/api/v2/university/imports/emissions/preview` | ADMIN, ENTRY | Validate CSV without inserting any rows |
| POST | `/api/v2/university/imports/emissions/commit` | ADMIN, ENTRY | Atomically import validated CSV as reviewable drafts |
| POST | `/api/v2/university/supplier-requests/:id/invite` | ADMIN, ENTRY | Issue a revocable single-use supplier capability |
| PATCH | `/api/v2/university/supplier-requests/:id/evidence` | ADMIN, ENTRY | Attach staff-uploaded clean evidence to supplier answers |
| POST | `/api/v2/university/supplier-requests/:id/approve` | ADMIN, REVIEWER | approve supplier response |
| POST | `/api/v2/university/supplier-requests/:id/reject` | ADMIN, REVIEWER | reject supplier response |
| POST | `/api/v2/university/materiality/:id/invite` | ADMIN, ENTRY | Issue one stakeholder survey capability |
| POST | `/api/v2/university/invites/:id/revoke` | ADMIN, ENTRY | Revoke an invitation without exposing its token |
| GET | `/api/v2/university/materiality/:id/summary` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read privacy-thresholded stakeholder materiality results |
| POST | `/api/v2/university/materiality/:id/close` | ADMIN, ENTRY | close materiality assessment |
| POST | `/api/v2/university/materiality/:id/reopen` | ADMIN, ENTRY | reopen materiality assessment |
| POST | `/api/v2/university/materiality/:id/approve` | ADMIN, REVIEWER | approve materiality assessment |
| POST | `/api/v2/university/reports/:id/approve` | ADMIN, REVIEWER | approve frozen report snapshot |
| POST | `/api/v2/university/reports/:id/reject` | ADMIN, REVIEWER | reject frozen report snapshot |
| GET | `/api/v2/university/reports/:id/export` | ADMIN, REVIEWER, LEADERSHIP | Export an approved report as JSON, CSV or print-ready HTML |
| GET | `/api/v2/university/targets/:id/progress` | ADMIN, REVIEWER, LEADERSHIP | Compare a target with another approved inventory report |
| PATCH | `/api/v2/university/initiatives/:id` | ADMIN, ENTRY, REVIEWER | Update owned initiative progress without deducting projected savings |
| POST | `/api/v2/university/pcf-studies/preview` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Preview a physical-factor PCF screening scenario |
| POST | `/api/v2/university/pcf-studies/:id/submit` | ADMIN, ENTRY | submit PCF screening study |
| POST | `/api/v2/university/pcf-studies/:id/approve` | ADMIN, REVIEWER | approve PCF screening study |
| POST | `/api/v2/university/pcf-studies/:id/reject` | ADMIN, REVIEWER | reject PCF screening study |
| GET | `/api/v2/university/carbon/catalog` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Scope 1/2 methods, source checklist and controls |
| POST | `/api/v2/university/carbon/kpis/install` | ADMIN | Install 10 supplementary university KPI definitions |
| POST | `/api/v2/university/carbon/quantity/preview` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Reconcile fuel, meters, refrigerants or delivered-energy units |
| GET | `/api/v2/university/carbon/dashboard` | ADMIN, REVIEWER, LEADERSHIP | Read separate Scope 1 and Scope 2 location/market totals |
| GET | `/api/v2/university/carbon/readiness` | ADMIN, REVIEWER, LEADERSHIP | Check source gaps, pending records and corrective actions |
| GET | `/api/v2/university/carbon/export` | ADMIN, REVIEWER, LEADERSHIP | Export current Scope 1/2 alternative-method columns; not a frozen report |
| GET | `/api/v2/university/carbon/sources` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List tenant-scoped carbon sources |
| GET | `/api/v2/university/carbon/sources/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read carbon sources with tenant and ownership checks |
| POST | `/api/v2/university/carbon/sources` | ADMIN | Create carbon sources |
| GET | `/api/v2/university/carbon/boundaries` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List tenant-scoped carbon boundaries |
| GET | `/api/v2/university/carbon/boundaries/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read carbon boundaries with tenant and ownership checks |
| POST | `/api/v2/university/carbon/boundaries` | ADMIN | Create carbon boundaries |
| PATCH | `/api/v2/university/carbon/boundaries/:id` | ADMIN | Edit a draft carbon boundaries |
| GET | `/api/v2/university/carbon/factors` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List tenant-scoped carbon factors |
| GET | `/api/v2/university/carbon/factors/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read carbon factors with tenant and ownership checks |
| POST | `/api/v2/university/carbon/factors` | ADMIN, REVIEWER | Create carbon factors |
| PATCH | `/api/v2/university/carbon/factors/:id` | ADMIN, REVIEWER | Edit a draft carbon factors |
| GET | `/api/v2/university/carbon/instruments` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List tenant-scoped carbon instruments |
| GET | `/api/v2/university/carbon/instruments/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read carbon instruments with tenant and ownership checks |
| POST | `/api/v2/university/carbon/instruments` | ADMIN, REVIEWER | Create carbon instruments |
| PATCH | `/api/v2/university/carbon/instruments/:id` | ADMIN, REVIEWER | Edit a draft carbon instruments |
| GET | `/api/v2/university/carbon/records` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List tenant-scoped carbon records |
| GET | `/api/v2/university/carbon/records/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read carbon records with tenant and ownership checks |
| POST | `/api/v2/university/carbon/records` | ADMIN, ENTRY | Create carbon records |
| PATCH | `/api/v2/university/carbon/records/:id` | ADMIN, ENTRY | Edit a draft carbon records |
| GET | `/api/v2/university/carbon/actions` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List tenant-scoped carbon actions |
| GET | `/api/v2/university/carbon/actions/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read carbon actions with tenant and ownership checks |
| POST | `/api/v2/university/carbon/actions` | ADMIN, ENTRY, REVIEWER | Create carbon actions |
| GET | `/api/v2/university/carbon/voids` | ADMIN, REVIEWER, LEADERSHIP | List tenant-scoped carbon voids |
| GET | `/api/v2/university/carbon/voids/:id` | ADMIN, REVIEWER, LEADERSHIP | Read carbon voids with tenant and ownership checks |
| POST | `/api/v2/university/carbon/boundaries/:id/approve` | ADMIN, REVIEWER | Independently approve carbon boundaries |
| POST | `/api/v2/university/carbon/boundaries/:id/reject` | ADMIN, REVIEWER | Independently reject carbon boundaries |
| POST | `/api/v2/university/carbon/factors/:id/approve` | ADMIN, REVIEWER | Independently approve carbon factors |
| POST | `/api/v2/university/carbon/factors/:id/reject` | ADMIN, REVIEWER | Independently reject carbon factors |
| POST | `/api/v2/university/carbon/instruments/:id/approve` | ADMIN, REVIEWER | Independently approve carbon instruments |
| POST | `/api/v2/university/carbon/instruments/:id/reject` | ADMIN, REVIEWER | Independently reject carbon instruments |
| POST | `/api/v2/university/carbon/voids/:id/approve` | ADMIN, REVIEWER | Independently approve carbon voids |
| POST | `/api/v2/university/carbon/voids/:id/reject` | ADMIN, REVIEWER | Independently reject carbon voids |
| POST | `/api/v2/university/carbon/records/preview` | ADMIN, ENTRY | Preview a complete reviewed-source calculation without persistence |
| POST | `/api/v2/university/carbon/records/:id/submit` | ADMIN, ENTRY | submit source consumption or release record |
| POST | `/api/v2/university/carbon/records/:id/cancel` | ADMIN, ENTRY | cancel source consumption or release record |
| POST | `/api/v2/university/carbon/records/:id/approve` | ADMIN, REVIEWER | approve source consumption or release record |
| POST | `/api/v2/university/carbon/records/:id/reject` | ADMIN, REVIEWER | reject source consumption or release record |
| POST | `/api/v2/university/carbon/records/:id/request-void` | ADMIN, ENTRY | Request a non-destructive correction of a calculation |
| POST | `/api/v2/university/carbon/actions/:id/resolve` | ADMIN, ENTRY, REVIEWER | resolve university corrective action |
| POST | `/api/v2/university/carbon/actions/:id/close` | ADMIN, REVIEWER | close university corrective action |
| POST | `/api/v2/university/carbon/actions/:id/reopen` | ADMIN, REVIEWER | reopen university corrective action |
| POST | `/api/v2/university/carbon/imports/preview` | ADMIN, ENTRY | preview source consumption CSV |
| POST | `/api/v2/university/carbon/imports/commit` | ADMIN, ENTRY | commit source consumption CSV |
| GET | `/api/v2/university/ingestion/capabilities` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read import formats, normalization fields, limits and review requirements |
| GET | `/api/v2/university/ingestion/references` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read same-tenant sources, tasks and approved factors |
| GET | `/api/v2/university/ingestion/batches` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List saved import batches |
| POST | `/api/v2/university/ingestion/batches` | ADMIN, ENTRY | Create an Excel/CSV or multi-invoice import batch |
| GET | `/api/v2/university/ingestion/batches/:id/rows` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read all current staged rows across batch files |
| GET | `/api/v2/university/ingestion/batches/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read durable per-file processing and import status |
| POST | `/api/v2/university/ingestion/batches/:id/files` | ADMIN, ENTRY | Attach uploaded document IDs to the batch |
| GET | `/api/v2/university/ingestion/files/:id` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Read sheet/page previews, mapping suggestions and staged rows |
| POST | `/api/v2/university/ingestion/files/:id/preview` | ADMIN, ENTRY | Normalize selected sheets or invoice page groups into staging only |
| POST | `/api/v2/university/ingestion/files/:id/skip` | ADMIN, ENTRY | Explicitly exclude a file with an audit reason |
| POST | `/api/v2/university/ingestion/batches/:id/review` | ADMIN, ENTRY | Correct, confirm or skip up to 100 staged rows |
| POST | `/api/v2/university/ingestion/batches/:id/commit` | ADMIN, ENTRY | Atomically import selected READY rows as reviewable drafts |
| POST | `/api/v2/university/ingestion/batches/:id/complete` | ADMIN, ENTRY | Complete a batch after every file and row is resolved |
| POST | `/api/v2/university/ingestion/batches/:id/cancel` | ADMIN, ENTRY | Cancel an uncommitted batch without deleting evidence |
| GET | `/api/v2/university/ingestion/batches/:id/export` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | Export normalized rows and errors as XLSX, CSV or JSON |
| GET | `/api/v2/university/ingestion/templates` | ADMIN, ENTRY, REVIEWER, LEADERSHIP | List reusable tenant-scoped mapping templates |
| POST | `/api/v2/university/ingestion/files/:id/template` | ADMIN, ENTRY | Save the reviewed sheet/page mapping as a reusable template |

Portal: `GET /api/v2/university/portal` and `POST /api/v2/university/portal/submit`. Header: `Authorization: Capability <token>`. No staff session is accepted in place of a capability.
