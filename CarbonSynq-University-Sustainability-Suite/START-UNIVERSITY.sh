#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/scale-api"
command -v node >/dev/null || { echo 'Install Node.js before continuing.'; exit 1; }
command -v docker >/dev/null || { echo 'Install and start Docker with Compose.'; exit 1; }
npm run setup
docker compose up --build -d
printf '\nOpen http://localhost:8080/university after the services are ready.\n'
printf 'For a NEW university only: docker compose run --rm migrate node scripts/provision.mjs\n'
printf 'Existing installations: keep your tenant and read docs/university/UPGRADE.md.\n'
