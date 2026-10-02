#!/bin/sh
set -eu
cd "$(dirname "$0")/scale-api"
node --version
docker compose version
npm run setup
docker compose up --build -d
printf '\nOpen http://localhost:8080/operations\nFresh installation only: docker compose run --rm migrate node scripts/provision.mjs\nExisting installation: preserve credentials and follow docs/operations/UPGRADE.md.\n'
