#!/usr/bin/env bash
# Run all tests: backend store/session unit tests + client<->server integration tests.
#   tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Playwright: use a local install if present, else a NODE_PATH global.
if [ -z "${NODE_PATH:-}" ] && [ -d /opt/node22/lib/node_modules ]; then
  export NODE_PATH=/opt/node22/lib/node_modules
fi

echo "== backend store/session unit tests =="
node tests/store.test.mjs

echo
echo "== client<->server integration tests =="
node tests/integration.test.mjs
