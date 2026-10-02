# Start here: Neon + localhost:5000

This package contains a safe scale-api/.env skeleton adapted to the new university backend.
Posted database/API secrets are NOT included, NOT tested and NOT rotated by this update.

1. Rotate the exposed credentials in their provider dashboards. Use a separate approved Neon demo branch.
2. Open scale-api/.env and replace the ENTIRE DATABASE_OWNER_URL with the newly rotated connection string.
3. In scale-api: npm run env:prepare, then npm run env:check.
4. Docker running: npm run neon:up, then npm run neon:status.
5. Fresh tenant only: npm run neon:provision. Do not repeat for existing tenants.
6. Open http://localhost:5000/university (imports at /university/imports, operations at /operations).

Use START-NEON-5000.cmd on Windows after editing the owner URL. Old launchers and the old compose.yaml are NOT this Neon profile; they remain preserved for their historical workflows.

The new Compose file uses Neon, not a hidden local Postgres substitute. API and worker do not receive the owner URL. Runtime URLs are direct endpoints with TLS verification and a small bounded pool. Provider/JWT settings from the old backend are not read by scale-api; adding them does not connect the provider.

Existing .env, role passwords, encryption keys and evidence volumes must be preserved. Do not blindly replace an existing installation with the shipped skeleton. Read the existing-installation section first.

Full guide: scale-api/docs/environment/SETUP.md
Verification: scale-api/docs/environment/VERIFICATION.md
Environment HLD supplement: scale-api/docs/environment/HLD.md
