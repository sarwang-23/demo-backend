# Start here - Excel and multi-invoice university release

This is the integrated university Scope 1/2 suite plus governed XLSX/CSV normalization and PDF invoice batches. New code lives in `scale-api`, not the root SQLite demo.

**Fresh setup:** follow `scale-api/docs/ingestion/UPGRADE.md`. With Node, Docker Compose and Internet available:

```sh
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose run --rm migrate node scripts/provision.mjs
```

Then open `http://localhost:8080/university` for university/source/factor setup and `http://localhost:8080/university/imports` for intake. Use the provisioned tenant ID and credentials. Existing deployments: preserve environment/data and follow the upgrade section instead of provisioning again.

Core manual entry, ESG/KPI collection, invoice evidence, enhanced Scope 1/2, supplier/materiality/report/target modules are retained. This release fills the specific messy-spreadsheet and multi-invoice intake gap. It is not proof of a complete university ERP or compliance system.

New workflow: original -> scan -> parse -> mapping -> normalization -> human review -> selected draft import -> existing independent approval. Supports common XLSX/CSV tables and readable PDF invoices, with manual scan fallback. Up to 20 files/batch, 10 MiB/file, 100 MiB total, 500 normalized rows/file, 1000/batch and 100 selected rows per atomic draft import.

See `scale-api/docs/ingestion/HLD.md`, `HLD-AND-FULL-CODE.md`, `DEMO-GUIDE.md`, `VERIFICATION.md` and `PRODUCTION-GATES.md`. Synthetic messy workbook, six individual invoices, combined six-invoice PDF and manual-fallback file are in `scale-api/samples/ingestion`.

Old root `npm start` remains the original SQLite demo. Real PostgreSQL/S3/ClamAV/Docker and native browser acceptance are not claimed passed. No OCR/SSO provider is connected. Original edited-file backups are in `upgrade-backup/scope12-v2.2`; the file-preservation report records every original path.
