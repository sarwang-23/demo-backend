# Screenshot-to-university feature mapping

This is an original CarbonSynq implementation inspired by the supplied workflow screenshots. It does not reproduce Breathe ESG/INARA branding, claim their integrations, copy their sample metrics, or infer their unseen backend code.

| Screenshot area | University implementation in this release | Deliberate boundary |
|---|---|---|
| ESG data management | Campus/department ownership; 22 templates; custom typed KPIs; period/source/interval tasks; required evidence; range/unit checks; independent review; corrective revisions; missing-task lists | KPI collection and emissions are separate ledgers. No automatic inferred carbon posting. No sensitive student-level or health records should be entered. |
| Manual / spreadsheets / OCR / API | Manual forms; authenticated JSON API; bounded CSV preview and atomic draft import; existing original-file upload, scan worker and manual review | CSV is supported, not native XLSX parsing. OCR is not connected. Staff review consumption; currency is not mistaken for energy. |
| Carbon accounting | Existing electricity/diesel/petrol/LPG/gas Scope 1/2; added refrigerant leakage and purchased heat/cooling; governed factor versions; decimal calculations; combined reporting | No official factors assumed; gas-specific GWP and source boundary must be supplied. Market-based Scope 2, certificates and offsets are not implemented. |
| Scope 3 emissions | Purchased goods/food/water, capital goods, upstream energy, freight, waste/wastewater, business travel/hotels, employee commuting and leased assets; estimates and spend-proxy labelling | Supports applicable activities in categories 1-8. All 15 categories have a relevance/exclusion register, not 15 complete calculation engines. No financed-emissions attribution for investments. |
| Student travel | Aggregate commuting estimator and supplemental student travel ledger | A conservative application boundary, not a claim that all standards universally forbid another classification. The institution must approve its reporting boundary. |
| Product Carbon Footprint | Optional university research/product/project screening with supplied BOM/process rows, valid physical factors, allocations, functional unit and missing-stage warnings | Not required for every university. No generated BOM, full LCA/EPD/ISO 14067 claim, uncertainty engine or automatic posting to the organizational inventory. |
| Decarbonisation | Approved report baseline; absolute targets; scoped comparison; initiatives, owners, dates, investment/savings assumptions and progress | Project estimates do not deduct from the inventory. Report-to-report changes are not proof of causal project savings. No optimizer, verified abatement curve, offset/net-zero certification or automated milestones. |
| Reporting | Locked-period repeatable-read snapshots, SHA-256 integrity check, reviewer approval, provenance and evidence, JSON/CSV/print-ready HTML | No bundled PDF/DOCX/XLSX renderer or regulatory filing connector. Not automatic BRSR/CSRD/GRI/STARS compliance. Framework applicability must be assessed independently. |
| Materiality | Topics, stakeholder group invitations, impact/financial 1-5 ratings, thresholds, minimum 5 responses, suppressed small-group results, independent snapshot review | Exploratory unweighted aggregation only. Not a statutory double-materiality assessment, representative sampling guarantee or anonymity against privileged database operators. |
| Value chain | Supplier registry; typed questionnaires; one-time expiring/revocable tokens; external response portal; staff evidence attachment; separate approval | Tokens are shared manually via an approved channel; no email is sent. External suppliers cannot directly upload files. Approved answers do not automatically post emissions. |
| AI / knowledge layer | Approved-record lexical search and 5 supported deterministic insight questions, with source record references | Explicit `aiAvailable:false`. No LLM, vector database, agent, autonomous recommendations, semantic search or ungrounded confidence scores. |
| ERP / SAP / IoT / meters | Source IDs and authenticated API ingress support future connector development | No live ERP/SAP/IoT connector, webhook receiver, service-account API keys or telemetry stream is configured. Do not share a staff password with a device. |
| Role-based access | Existing university tenant session roles, RLS policy, new assignment checks and self-approval prohibition | No full campus/department ABAC overhaul of the old core routes; SSO/MFA and delegated campus administration remain production work. |

## University relevance

The selected data areas include academics, training/community engagement, energy, water, greenhouse gases, dining procurement, waste and commuting. AASHE's publicly listed STARS topic areas include these higher-education concerns. This overlap is a planning reference only, not implementation of the STARS scoring/reporting system.

Sources checked on 2026-10-02:
- AASHE STARS technical materials and credit index: https://stars.aashe.org/resources-support/technical-manual/
- GHG Protocol category-7 guidance, including its discussion of employee commuting and optional relevant non-employees: https://ghgprotocol.org/sites/default/files/standards_supporting/Chapter7.pdf
- GHG Protocol Scope 3 calculation guidance overview: https://ghgprotocol.org/scope-3-calculation-guidance-2

## Do not create false totals

Do not add litres, kWh and kg into one consumption number. Do not add monthly headcounts into annual FTE. Do not add student supplemental emissions, PCF scenarios, initiative estimates, renewable generation or supplier responses into organizational carbon totals without an explicit reviewed methodology. The code keeps these flows separate.
