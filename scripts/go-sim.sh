#!/usr/bin/env bash
# Switch the local backend back to SIMULATION (no real funds), restoring agent/.env.dev.
# Live records stay untouched in agent/data/live.json; revoke live permissions before discarding them.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f agent/.env.dev ]; then
  cp -p agent/.env.dev agent/.env
else
  cp agent/.env.example agent/.env
fi
chmod 600 agent/.env
scripts/dev.sh
for _ in $(seq 1 25); do sleep 2; curl -s -m 2 http://localhost:8842/ >/dev/null 2>&1 && break; done
echo "backend: $(curl -s -m 3 http://localhost:8842/ || echo 'not responding yet')"
