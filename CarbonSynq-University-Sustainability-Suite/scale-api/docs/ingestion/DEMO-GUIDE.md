# CEO demo - Excel and six invoices

## Pehle ek rehearsal

Fresh local stack UPGRADE.md ke commands se start karo. Demo-only tenant use karo. `samples/ingestion` ke names aur numbers synthetic hain. Official-factor/assurance claim mat karo.

`/university` mein reporting period 2026-04-01 to 2027-03-31, campus code TEST, source MAIN_GRID (purchased electricity, kWh), assigned ENTRY owner, independently approved factor aur boundary ready karo. Scope 2 fallback factor/reason bhi applicable configuration ke mutabik approved hona chahiye. Aapke source/campus codes different hon to mapping ya row correction mein explicitly fix karo; source ID default se wrong uploaded meter overwrite nahi hoga.

Entry aur separate reviewer credentials accessible rakho. Same period/source ke April-June records already present hon to sample duplicates intentionally reject honge. Fresh scenario use karo; existing real data delete mat karo.

## Scenario A - messy Excel ko structured banana

1. `/university/imports` par ENTRY login. New batch: SPREADSHEET / CARBON / correct period.
2. `University-Messy-Data.xlsx` upload. Har stage aur original-file link dikhao. CLEAN scan/REVIEW_REQUIRED ke baad mapping kholo.
3. `Messy electricity` sheet, header row 5, DMY dates, IN_EN number format. Suggested headers verify karo: Units consumed -> quantity, UOM -> unit; Bill amount -> amountInr only.
4. Registered source, approved factor and valid fallback/reason choose karo. Normalize.
5. Show 5 staged rows: 3 readings, 1 repeated header and 1 subtotal visibly SKIPPED. May ka `1.50 MWh` becomes `1500.000000 kWh`.
6. Raw source vs normalized fields side-by-side kholo. Invalid blanks/date ambiguity ko explicit correction se resolve karo. Review three actual readings, not subtotal.
7. READY rows select -> Import reviewed drafts. Ab three DRAFTs hain; emissions total abhi unchanged.
8. Existing Scope 1/2 workspace mein drafts submit karo; separate reviewer approve karega. Tab calculated ledger/report update hoga.
9. Normalized XLSX aur issue CSV export dikhao. Batch complete karo after all rows resolved.

Narration: "Original university data unchanged hai; system mapping, units, dates, review aur evidence ka record rakhta hai. Upload karna approval nahi hai."

## Scenario B - 5-6 invoices ek saath

New INVOICE / CARBON batch banao. `invoices` folder ki six PDF files ek saath select karo. Two concurrent transfers, per-file scan/extraction results, retry and error state show karo. One file problem se baaki originals disappear nahi hote.

Pehli file ka source/factor/fallback setup confirm karo. **Normalize remaining invoices** se same-source clean files stage karo; mixed-source invoices par shared defaults blindly apply mat karo. **Review all batch rows** kholo. Har invoice ka vendor, number, account, period, quantity aur INR amount alag columns mein dikhega.

Six synthetic invoices: April 1250, May 1500, June 1100, July 1320, August 1450, September 1280 kWh. Combined consumption = 7900 kWh, not the sum of invoice rupees. This is a fixture total, not official emissions.

Each candidate human-reviewed READY hona chahiye. Select up to 100 -> atomic draft import -> existing submit/separate reviewer flow. Same source/date previously Excel se imported ho to April-June overlap rejection EXPECTED hai; only unrelated valid intervals import karo, ya a separate clean demo scenario use karo. Never relabel an actual meter just to bypass duplicates.

## Scenario C - one PDF containing six invoices

Use `Six-Invoices-One-PDF.pdf` in a fresh appropriate scenario. Suggested six page groups inspect karo; page ranges manually change kar sakte ho. It contains the SAME invoices as six individual PDFs. Importing both versions twice must not create duplicate inventory.

## Scenario D - scan and deliberate errors

`Image-Only-Manual-Review.pdf` is image-only: show honest manual-required behavior. Actual consumption 800 kWh, period 2026-10-01 to 2026-10-31, invoice DEMO-SCAN-001 and displayed vendor/amount can be entered after viewing the original. The system does not pretend OCR ran.

Needs review sheet contains a blank consumption and an ambiguous date. Show that INR 12000 never becomes a quantity, and blank never becomes zero. Wide diesel sheet requires DG_DIESEL and a valid fuel factor/boundary; monthly-column unpivot creates two intervals, never a combined electricity record.

## Boundary to tell the CEO accurately

The application now contains the demo workflow and editable source code. The actual-file parser and synthetic local UI/domain paths were tested. Real PostgreSQL/S3/ClamAV deployment and native browser acceptance still need the staging checks. No automatic OCR, ERP/IoT sync, SSO/MFA, certified reporting or official factor library was added in this release.
