# CarbonSynq University - Scope 1 & Scope 2 upgrade

**Version 2.2.0-scope12-rc.1.** Integrated source code, not a mock architecture-only package. The current application is `scale-api/`; the old root SQLite demo and original Neon project are still separate and preserved.

## Start here

Fresh local deployment (Node.js22.16+, Docker Compose and internet required):

```bash
cd scale-api
npm run setup
docker compose up --build -d
docker compose ps
docker compose run --rm migrate node scripts/provision.mjs
```

Open `http://localhost:8080/university`, sign in with the printed tenant/admin credentials, and choose **Scope 1 & 2**. Use a separate reviewer for approvals. Existing root `START-UNIVERSITY.cmd` and `.sh` remain. **Root `npm start` runs the older SQLite demo, not this suite.**

For an existing database **do not provision again or overwrite `.env`**. Read `scale-api/docs/carbon/UPGRADE.md` before applying migration003. Existing data is retained; enhanced mode needs a clean Scope 1/2 period or a separately reviewed history-migration plan.

## What was added

- Source register, reviewed campus/operational boundary, fuel stock/meter reconciliation, mobile fuel, refrigerant balance/top-up, named gas/GWP factors and separate biogenic CO2.
- Purchased electricity/steam/heat/cooling, location and market alternative totals, independently reviewed energy attribute evidence, residual fallback and quantity-allocation controls.
- Missing-source/date checks, corrective actions, no-self-approval, non-destructive corrections, report/period readiness gates, fixed-method targets and traceable export.
- Ten optional university KPI definitions, a new console section, 49 authenticated API operations and ten additive database tables.

No real factor, measurement or certificate approval is automatically seeded. Supplier registry eligibility, official factors and the institution's source boundary require human review. AI OCR, SSO/MFA and ERP/IoT are not connected.

## Code and evidence

- `scale-api/docs/carbon/HLD.md` - current architecture/accounting design.
- `scale-api/docs/carbon/HLD-AND-FULL-CODE.md` - HLD plus complete integrated scale-api source listing.
- `scale-api/docs/carbon/openapi.json` - new operation contract.
- `scale-api/docs/university/openapi.json` - integrated university API.
- `scale-api/docs/carbon/CEO-DEMO-GUIDE.md` - rehearsal.
- `scale-api/docs/carbon/VERIFICATION.md` - actual test results and limitations.
- `scale-api/docs/carbon/UNIVERSITY-GAP-MAP.md` - included and still-outstanding needs.
- `scale-api/docs/carbon/PRODUCTION-GATES.md` - acceptance before live use.
- `SCOPE12-PRESERVATION.txt` - input ZIP file preservation audit.

```bash
cd scale-api
npm test
npm run check:university
npm run carbon:demo
```

The arithmetic demo is disposable and synthetic. Passing memory/unit/HTTP tests does not mean PostgreSQL, storage, scanner, native browser or production deployment has been verified. Historical documents retained elsewhere describe earlier releases; this README and `docs/carbon/` govern the upgrade.
