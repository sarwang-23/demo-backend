#!/bin/sh
set -eu
cd "$(dirname "$0")/scale-api"
echo 'Enter the rotated DATABASE_OWNER_URL in .env first. This starts migrations on your selected database.'
node --version
npm run env:prepare
npm run env:check
docker compose version
npm run neon:up
npm run neon:status
echo 'Default: http://localhost:5000/university ; fresh tenant only: npm run neon:provision'
