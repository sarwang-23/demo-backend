# Start here: the additive scale upgrade

The new product-scale **source foundation** is in `scale-api/`. Read `scale-api/README.md` and `scale-api/docs/HLD.md`.

The previous package's files remain unchanged. Root `npm start` still launches the old local SQLite demo. `original-neon-backend/` is still the original separate TypeScript/Neon service. Neither was silently migrated.

For the new backend, use `START-SCALE.cmd` on Windows, or:

```bash
cd scale-api
npm run setup
docker compose up --build -d
docker compose run --rm migrate node scripts/provision.mjs
```

Open `http://localhost:8080` with the newly printed tenant UUID and credentials. Node, Docker Compose and Internet access are required for first-time infrastructure setup. No live PostgreSQL/S3/Docker installation or Windows launcher execution was verified in the delivery environment.

The new code includes shared PostgreSQL state, durable independent jobs, private versioned invoice storage, tenant/role controls, approval/calculation invariants, operational scripts, tests and a responsive console. New empty workspaces do not contain official factors or invented emissions. Supply real approved factors and validate your staging environment before customer use.

This is **not a production-certification or traffic-capacity claim**. See `scale-api/docs/PRODUCTION-GATES.md` and `scale-api/docs/VERIFICATION.md`. `scale-api/docs/HLD-AND-FULL-CODE.md` contains the new HLD and consolidated code; prior codebooks remain unchanged.
