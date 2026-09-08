#!/usr/bin/env bash
# Starts the agent API and Metro in a detached tmux session named "mandate".
#   scripts/dev.sh        start (or restart) both
#   tmux attach -t mandate   watch logs;  Ctrl-b d to detach
set -euo pipefail
cd "$(dirname "$0")/.."
tmux kill-session -t mandate 2>/dev/null || true
tmux new-session -d -s mandate -n agent "cd agent && npx tsx watch src/index.ts 2>&1 | tee /tmp/agent.log"
tmux new-window -t mandate -n metro "CI=1 npx expo start --port 8081 2>&1 | tee /tmp/metro.log"
echo "started tmux session 'mandate' (agent :8842, metro :8081)"
