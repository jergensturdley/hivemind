#!/usr/bin/env bash
# End-to-end smoke: starts the production server on a scratch port, runs
# scripts/smoke.py against it, tears down. Needs Postgres up (`npm run db:up`).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${1:-3100}"
LOG="$(mktemp -t hivemind-smoke.XXXXXX)"

# Point the Codex device-login + Responses API at the smoke mock (scripts/smoke.py).
export CODEX_AUTH_ISSUER="http://127.0.0.1:3123"
export CODEX_API_BASE="http://127.0.0.1:3123"

if ! command -v python3 >/dev/null; then
  echo "smoke: python3 is required" >&2
  exit 1
fi

npx next start -p "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT

for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "smoke: server did not come up on :$PORT — is Postgres running? log: $LOG" >&2
  exit 1
fi

python3 scripts/smoke.py "$PORT"
