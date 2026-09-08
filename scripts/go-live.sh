#!/usr/bin/env bash
# Switch the local backend to LIVE execution (real funds under signed Spend Permissions).
#
#   scripts/go-live.sh                       # generates a persistent spender key if agent/.env has none
#   OPENROUTER_API_KEY=sk-or-... scripts/go-live.sh
#
# What it does: backs up the current agent/.env to agent/.env.dev (once), writes a live .env
# (DRY_RUN=0, persistent AGENT_PRIVATE_KEY, separate DB_PATH=data/live.json), restarts the
# agent + Metro tmux session, and prints the spender address you must fund with ETH on Base.
# Switch back with scripts/go-sim.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=agent/.env

existing() { grep -E "^$1=" "$ENV" 2>/dev/null | head -1 | cut -d= -f2- || true; }

KEY="${AGENT_PRIVATE_KEY:-$(existing AGENT_PRIVATE_KEY)}"
if [ -z "$KEY" ]; then
  KEY=$(cd agent && node -e "console.log(require('viem/accounts').generatePrivateKey())")
  echo "generated a new spender key (kept only in $ENV)"
fi
ADDRESS=$(cd agent && node -e "console.log(require('viem/accounts').privateKeyToAccount('$KEY').address)")
OR_KEY="${OPENROUTER_API_KEY:-$(existing OPENROUTER_API_KEY)}"
MODEL="${MODEL:-$(existing MODEL)}"; MODEL="${MODEL:-google/gemini-2.5-flash}"

if [ -f "$ENV" ] && [ ! -f agent/.env.dev ] && grep -qE '^DRY_RUN=1' "$ENV"; then
  cp -p "$ENV" agent/.env.dev && chmod 600 agent/.env.dev && echo "saved the simulation config to agent/.env.dev"
fi

umask 077
cat > "$ENV" <<EOF
# LIVE MODE. Gitignored. Trades use real funds under signed Spend Permissions.
# Keep this machine and this file private. Simulation config: agent/.env.dev (scripts/go-sim.sh).
DRY_RUN=0
# Persistent spender EOA. Users authorize this address; keep the key backed up.
AGENT_PRIVATE_KEY=$KEY
# Live records live in their own database; never reuse data/db.json (simulation).
DB_PATH=data/live.json
BASE_RPC_URL=https://mainnet.base.org
# Required for chat and AI decisions (in-app key setup is dry-run only).
OPENROUTER_API_KEY=$OR_KEY
MODEL=$MODEL
DEV_AI_SETTINGS=0
AGENT_INTERVAL_MIN=30
PORT=8842
EOF
chmod 600 "$ENV"

scripts/dev.sh
for _ in $(seq 1 25); do sleep 2; curl -s -m 2 http://localhost:8842/ >/dev/null 2>&1 && break; done
echo
echo "backend: $(curl -s -m 3 http://localhost:8842/ || echo 'not responding yet; check tmux attach -t mandate')"
echo "spender: $ADDRESS"
echo
echo "Next:"
echo "  1. Send ~0.005 ETH on Base to $ADDRESS for gas (Settings → Live trading shows the balance)."
[ -z "$OR_KEY" ] && echo "  2. Add your OpenRouter key: OPENROUTER_API_KEY=sk-or-... scripts/go-live.sh (chat needs it)."
echo "  3. Create a NEW mandate in the app; simulation mandates cannot go live."
