# CarbonSynq University Intake - High-Level Design

Release `2.3.0-ingestion-rc.1` | 2026-10-02 | Additive upgrade to the university Scope 1/2 suite

## 1. What this delivery is

This release integrates XLSX/CSV normalization and multi-PDF invoice intake into the existing `scale-api` application, PostgreSQL tenant model, private document storage, scanner worker, university collection workflows and enhanced Scope 1/2 ledger. It is not a second disconnected backend. The previous root SQLite demo and original Neon repository are retained, not migrated or replaced.

The primary gap addressed is **raw uploaded evidence -> structured candidate rows -> normalized quantities/dates -> explicit human review -> existing draft record**. Uploaded evidence does not become approved data just because parsing succeeded. This is a locally tested release candidate, not a production certification or a promise that every possible spreadsheet layout can be understood automatically.

## 2. Implemented topology

```text
Browser /university/imports
  | session + same-origin HTTP; 2 concurrent bounded file transfers
  +--> existing POST /api/v2/documents/upload
  |       -> tenant quota + file signature + SHA-256
  |       -> private versioned S3 object
  |       -> durable SCAN_INVOICE job
  |       -> worker integrity check -> ClamAV (fail closed)
  |       -> bounded Python child process, no shell / no inherited secrets
  |          + XLSX: bounded OOXML + openpyxl + defusedxml
  |          + CSV: UTF-8 comma/semicolon/tab table
  |          + PDF: pdfinfo + pdftotext; no OCR
  |       -> original retained; extraction stored on document
  |
  +--> /api/v2/university/ingestion/* (17 new staff operations)
          -> same shared tenant transaction / RLS / role guards
          -> batch + file mappings + versioned staged rows
          -> normalization and existing domain validation
          -> human correction / confirmation / exclusion
          -> atomic selected-row commit (1-100 rows)
             + CARBON: existing Scope 1/2 DRAFT record
             + KPI: existing assigned-task DRAFT submission
             + EMISSION: existing supported university DRAFT emission
          -> existing separate submit / reviewer approval / calculation
          -> approved inventory / reports (unchanged accounting boundary)
```

There is no LLM, remote AI call, OCR service or automatic assurance claim. The original file's bytes remain in private storage. Excel cell coordinates, sheet names, PDF page groups, mapping revision, raw mapped fields, normalized values, decisions and target record IDs remain traceable.

## 3. Intake and per-file status

A batch is a logical persisted collection, not one giant multipart request. Each file uses the existing independently retryable bounded upload endpoint. The browser transfers at most two files concurrently. One failing upload does not pretend that all other uploads failed or succeeded. Successful files attach to the saved batch; a failed attachment can be retried using the existing document ID. Resuming a page requires login again because session tokens are not persisted in browser storage.

Existing document states and scanner results are displayed separately from import-file states. Unscanned, quarantined or infected evidence cannot be normalized/imported as clean. Parse failure produces an explicit parser error and manual-review state, not invented fields. A scanner error is not considered a clean scan. Extraction is triggered by the existing worker after the scan/integrity boundary, not directly from an untrusted browser.

Batch states: `OPEN -> REVIEWING -> COMPLETE`, or `CANCELLED` before anything is imported. File states: `ATTACHED -> PREVIEWED`, or `SKIPPED` with reason. Row states: `REVIEW / INVALID -> READY -> IMPORTED`, with `SKIPPED` and historical `SUPERSEDED`. New mapping revisions preserve old raw rows. Once any row from a file has been imported, that file's mapping is frozen; remaining row corrections stay explicit.

## 4. Spreadsheet structuring

The parser supports ordinary `.xlsx` and UTF-8 `.csv`, not binary `.xls`, `.xlsb`, macro-enabled `.xlsm`, passwords, remote spreadsheet links or arbitrary embedded objects. Original workbooks are not rewritten.

For each selected sheet, the user confirms the header row and column-to-field mapping. Header aliases are suggested from the first 50 physical rows; a later header can be selected explicitly. Titles, blank rows, repeated headers and obvious summary rows are handled without treating totals as new measurements. Excluded nonblank rows remain visible as SKIPPED, with a reason. Up to 10 sheet plans can be staged together, within the file row cap.

Merged identifier/context cells can be resolved from their anchor. Optional forward-fill is restricted to identifiers and context; it never invents a missing consumption quantity or date. Hidden sheets/rows are excluded unless explicitly included. Monthly column layouts such as `Apr 2026`, `May 2026` or `2026-04` can be unpivoted into individual interval records. Multi-level headers, multiple unrelated tables on one sheet, arbitrary rotated layouts and charts-as-data require manual restructuring or separate imports.

Formulas are preserved as formula metadata, never executed or trusted as cached input. Formula-based measurement cells must receive an explicit reviewed value before READY. Excel error cells and ambiguous merged measurement cells are similarly flagged. Unformatted date serial numbers are not guessed to be dates.

## 5. Normalization contract

Canonical fields include quantity, unit, interval start/end, activity date, campus/source/task identifiers, KPI/category, factor references, data quality, assumptions, invoice vendor/number/account/line reference, currency amount and description.

* Values use decimal strings with six places for quantities, not IEEE floating-point accumulation. English/Indian grouping (`1,25,000`) and explicitly selected decimal comma (`1.250,50`) are supported. There is no silent precision rounding.
* Dates are ISO `YYYY-MM-DD` or explicitly DMY/MDY. Ambiguous `04/05/2026` in AUTO mode is a correction issue, not an assumed date. Invalid calendar dates and reversed intervals fail.
* Explicit MWh is converted to kWh by 1000; KL to litres by 1000; tonnes to kg by 1000. KPI litres/cubic-metres conversion is exact and checked. Fuel density, calorific conversion and hidden unit assumptions are never guessed.
* Blank is missing, not zero. Negative values require the established correction workflow. INR amount is informational and never substituted for physical consumption.
* Uploaded source/campus/KPI labels must resolve exactly to one registered entity. A default source ID conflicting with the uploaded meter code fails, rather than silently allocating the row to the wrong meter.

Example:

| Raw input | Normalized result | Decision |
|---|---|---|
| `1.50` + `MWh` | `1500.000000 kWh` | Review conversion and original |
| `1,25,000` + `kWh` | `125000.000000 kWh` | Explicit English/Indian convention |
| `04/05/2026` | No automatic date in AUTO | Choose DMY or MDY |
| blank consumption + INR `12000` | Missing quantity | Amount cannot fill quantity |
| subtotal / repeated header | SKIPPED with original row | Not an additional activity |

## 6. Five or six PDF invoices

The workbench accepts several PDF files in one selection. Each file preserves its own original, scan status, parsing status, page groups, row decisions and errors. With a consistent source/factor setup, **Normalize remaining invoices** applies the reviewed setup to the remaining clean, unpreviewed PDFs. The next action **Review all batch rows** displays their candidates in one table; it does not silently import them.

A PDF may also contain multiple invoices. Candidate page groups are suggested using explicit invoice identifiers; repeated identifiers and continuation pages are grouped conservatively. The user may edit page ranges. Distinct invoice IDs in one selected group, multiple consumption lines, missing intervals and uncertain values are flagged for correction. One invoice group represents one reviewed consumption entry; a full automatic tax-line-item parser or general multi-product invoice splitter is not implemented.

Text extraction supports readable PDF text layers. Image-only scans upload normally but need manual vendor, invoice identity, consumption, dates and source/factor entry. No OCR output or confidence score is fabricated. Invoice issue date is not silently substituted for its consumption interval. Originals can be inspected/downloaded through the existing authorized document route.

## 7. Integration with university accounting

**CARBON** invokes the same enhanced source/factor/boundary validation as manual Scope 1/2 entry. Registered source, interval and approved factor requirements still apply. Uploaded fuel quantity must represent consumption, not just fuel purchased; cumulative meters and stock must first be reconciled through the existing specialist workflow. Bulk intake currently creates consumption-mode records; meter rollover, refrigerant mass balance, stock balance and contractual Scope 2 allocations remain in the enhanced manual Scope 1/2 workspace. For energy imports the supported fallback factor/reason must be supplied; contractual instruments are not automatically inferred from invoices.

**KPI** maps to an existing assigned task with matching campus/KPI/interval. Existing current data is not overwritten by importing another row. Quantity is converted only using supported exact compatible units. KPI collection does not create carbon emissions by itself.

**EMISSION** invokes the existing supported university emission service and approved factor selection; the existing enhanced-vs-legacy Scope 1/2 period guard still prevents double ledgers.

Import writes DRAFTs only. Creator/importer cannot bypass separate reviewer approval. Existing Scope 1/2 dual reporting, biogenic disclosure, frozen reports, period locks and corrections are retained. Location- and market-based totals are not added together. This release does not claim new official emission factors or universal regulatory compliance.

## 8. Duplicate, transaction and concurrency controls

File SHA-256 duplicate detection remains tenant-scoped in the document service. Logical import identities additionally use normalized vendor/invoice/account/line references or normalized source/task/interval/quantity attributes. KPI and emissions identities occupy different namespaces to avoid treating an evidence-backed KPI as an approved carbon calculation. Source-domain overlap checks independently reject a second live Scope 1/2 entry covering the same source dates.

A row review may leave invalid rows INVALID; a confirmation checkbox does not erase errors. Explicit corrections carry a reason and leave raw source values unchanged. All mutations use current optimistic versions and the shared required Idempotency-Key request cache. A retried exact commit returns its prior result; a changed payload needs a new key.

Commit selects 1-100 READY rows, takes tenant-scoped identity locks in deterministic order, rechecks file cleanliness, period, role, source, factor, domain conflicts and duplicates, then writes target drafts, receipts and audit events in one existing PostgreSQL transaction. One selected-row failure rolls back the entire selection. Previously committed selections and successful file uploads remain real; there is no false claim that a 1000-row batch or all uploads are one transaction.

## 9. Additive database migration 004

| Table | Purpose |
|---|---|
| `u_i_batches` | Period, target, kind, owner, state and version |
| `u_i_files` | Original document reference, plan, generation, skip reason |
| `u_i_rows` | Immutable raw/provenance, normalized values, issues, review and target receipt |
| `u_i_templates` | Tenant-scoped reusable mappings; no auto-approval |

All four tables have forced tenant RLS and composite tenant relationships. Rows reference the exact batch/file pair. A partial unique index permits only one imported receipt for a normalized identity. A database trigger rejects edits to imported receipts and raw provenance. Only one target record link is allowed on an imported row. These are database controls to be acceptance-tested on actual PostgreSQL; they are not cryptographic tamper evidence against a database administrator.

Migrations 001-003 are unchanged. Migration 004 also expands the allowed document MIME types. Original changed integration files are backed up at `upgrade-backup/scope12-v2.2/` with original bytes.

## 10. Security and parser boundary

Uploaded filenames, cell contents and invoice text are data, not commands or instructions. Existing role checks, authenticated tenant derivation, private storage, quota, signature checks, audit and request limits remain in use. The parser rejects encrypted/macro/embedded/external-link OOXML packages, suspicious paths, duplicate archive entries, XML declarations/entities and oversized expansion. PDF child processes are time/resource bounded. Python is launched with a restricted environment, no shell and no application secrets; filenames are generated internally. Unix process-group termination prevents a timed-out parser leaving Poppler children running.

Exported XLSX uses literal text cells (including values starting with `=`), and CSV formula-leading strings are escaped. Browser content uses escaped values/textContent. Authentication is not persisted in browser storage. No external JavaScript library or CDN is required for the console.

These measures are not a complete parser sandbox, malware assurance or penetration test. The container still needs production egress restrictions, isolation, patched dependencies and representative malicious-file tests. ClamAV signature availability and a CLEAN result are distinct from semantic correctness. Local Docker configuration is not a public deployment guide.

## 11. Explicit bounds

| Limit | Value |
|---|---|
| Files per batch | 20 |
| Original file / batch bytes | 10 MiB each / 100 MiB total |
| Workbook | 10 sheets, 2000 physical rows/sheet, 80 columns |
| OOXML expansion | 40 MiB total, 12 MiB per part, 1500 entries; ratio checks |
| Content | 60,000 populated/merged cells, 2,000,000 characters |
| PDF | 30 pages, bounded extracted text |
| Active normalized rows | 500/file; 1000/batch |
| Atomic review / commit | 100 rows/request |
| Retained mapping history | 20 generations/file; 20,000 rows/batch |
| Parser | 30-second wall timeout, 8 MiB stdout; Linux resource limits |

These are intentional safety/product bounds, not measured production throughput or a concurrency SLA. Oversized data should be partitioned into controlled batches.

## 12. User interface and exports

`/university/imports` contains saved batches, multi-file transfer status, source previews, mapping controls, date/number conventions, reusable templates, source/factor/task defaults, row-level corrections, batch-wide review, selected draft import and exports. Desktop and mobile layouts are included. The existing university sidebar links to it. Crossing to the separate console may require a fresh login, by design of in-memory sessions.

Normalized XLSX, CSV and JSON exports include source references, decision state, issues, review reason and target record ID. The issue export includes invalid and skipped rows. An export is an intake review document, not an independently verified emissions report. Original evidence remains separate and unchanged.

## 13. Operations and deployment

The runtime image now installs Python, openpyxl 3.1.5, defusedxml 0.7.1 and Poppler. Node remains the API/worker runtime. `PARSER_PYTHON` selects an administrator-controlled interpreter; it is never a user API argument. Python source and pinned direct requirements are included. Test-only PDF generation additionally uses ReportLab. See UPGRADE.md for fresh/upgrade commands, and PRODUCTION-GATES.md before live use.

Production dependency lockfiles/digests, a real PostgreSQL transaction/RLS test, S3/ClamAV queue round trip, backup-restore, native browser/CSP check and load/failure testing remain release gates. The delivery environment lacked Docker, PostgreSQL services and registry access; passing local memory-store tests do not prove those integrations.

## 14. Reference files

* `src/ingestion/`: parser bridge, normalization, routes, schema whitelist, staging service.
* `python/document_parser.py`: bounded workbook/PDF extraction and safe XLSX export.
* `migrations/004_ingestion.sql`: executable schema/constraints.
* `public/ingestion/`: runnable review workbench.
* `tests/ingestion/`: pure, parser, HTTP, domain, UI harness and PostgreSQL acceptance checks.
* `examples/ingestion/normalize-local.mjs`: local actual-file example, no database writes.
* `samples/ingestion/`: synthetic messy workbook and six invoices.
* `openapi.json`: 17-operation contract, also merged into university OpenAPI.

Technical references (not certification of this application):
https://openpyxl.readthedocs.io/en/stable/optimized.html
https://openpyxl.readthedocs.io/en/stable/api/openpyxl.reader.excel.html
https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
https://poppler.freedesktop.org/
https://www.postgresql.org/docs/17/ddl-rowsecurity.html
