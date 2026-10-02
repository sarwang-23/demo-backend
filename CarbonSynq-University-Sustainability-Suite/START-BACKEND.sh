#!/bin/sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is required; see README.md."; exit 1; }
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===22&&b>=16)||a>=24)){console.error('Use Node.js 22.16+ in the 22.x line, or 24+.');process.exit(1)}"
exec node server.mjs
