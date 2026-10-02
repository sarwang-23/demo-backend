#!/bin/sh
set -eu
cd "$(dirname "$0")/scale-api"
node scripts/setup-env.mjs
docker compose up --build -d
printf '\nCheck docker compose ps. Then create your tenant:\n'
printf 'docker compose run --rm migrate node scripts/provision.mjs\n'
printf 'Open http://localhost:8080 after services are healthy. Local integration only.\n'
