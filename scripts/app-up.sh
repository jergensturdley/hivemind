#!/usr/bin/env bash
# Build and run the Hivemind Next.js app in an Apple container.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="${HIVEMIND_WEB_NAME:-hivemind-web}"
IMAGE="${HIVEMIND_WEB_IMAGE:-hivemind-web:latest}"
HOST_PORT="${HIVEMIND_WEB_PORT:-3000}"
PG_NAME="${HIVEMIND_PG_NAME:-hivemind-pg}"
USER_NAME="${POSTGRES_USER:-postgres}"
PASSWORD="${POSTGRES_PASSWORD:-postgres}"
DB_NAME="${POSTGRES_DB:-app_db}"
SESSION_SECRET="${SESSION_SECRET:-hivemind-dev-secret}"

if ! command -v container >/dev/null 2>&1; then
  echo "Apple container CLI not found. Install it, then re-run." >&2
  exit 1
fi

bash scripts/db-up.sh

pg_ip="$(container inspect "$PG_NAME" | python3 -c 'import json,sys; n=json.load(sys.stdin)[0]["networks"][0]["ipv4Address"]; print(n.split("/")[0])')"
# The bridge gateway IP is stable for the life of the network, while the pg
# container's own IP can change whenever Postgres restarts. Pointing the app at
# the gateway (which forwards the published DB port) keeps DATABASE_URL valid
# across pg restarts and reboots, so keys/settings stay reachable. Fall back to
# the container IP if the gateway can't be determined.
PG_HOST_PORT="${HIVEMIND_PG_PORT:-5432}"
gateway_ip="$(container inspect "$PG_NAME" | python3 -c 'import json,sys; n=json.load(sys.stdin)[0]["networks"][0]; print((n.get("ipv4Gateway") or "").split("/")[0])' 2>/dev/null || true)"
if [[ -n "$gateway_ip" ]]; then
  database_url="postgresql://${USER_NAME}:${PASSWORD}@${gateway_ip}:${PG_HOST_PORT}/${DB_NAME}"
  echo "App will reach Postgres via stable gateway ${gateway_ip}:${PG_HOST_PORT}"
else
  database_url="postgresql://${USER_NAME}:${PASSWORD}@${pg_ip}:5432/${DB_NAME}"
  echo "App will reach Postgres at ${pg_ip}:5432 (gateway not detected)"
fi

# Outbound LLM traffic goes through the host-side CONNECT proxy
# (scripts/egress-proxy.mjs, LaunchAgent com.hivemind.egress-proxy): WARP
# TunnelOnly RSTs container NAT egress, but host-originated flows pass.
proxy_env=()
proxy_build_args=()
if [[ -n "$gateway_ip" ]] && nc -z "$gateway_ip" 8118 2>/dev/null; then
  proxy_env=(-e "HIVEMIND_EGRESS_PROXY=http://${gateway_ip}:8118")
  proxy_build_args=(--build-arg "HTTPS_PROXY=http://${gateway_ip}:8118")
  echo "App will egress via host proxy ${gateway_ip}:8118"
else
  echo "Egress proxy not reachable on ${gateway_ip:-?}:8118 — direct egress (needs WARP off)"
fi

if ! container builder status 2>/dev/null | grep -qi running; then
  echo "Starting Apple container builder…"
  container builder start -c 4 -m 8G
fi

# Harness detection: resolve coding-agent CLIs on the operator's machine now
# and hand the results to the app — the container's own PATH can't see host
# installs, and host bins are often symlinks into version dirs that don't
# survive a read-only mount.
HOST_HARNESSES_ENV=""
for b in claude codex grok cursor-agent cursor aider gemini opencode; do
  p="$(command -v "$b" 2>/dev/null || true)"
  [[ -z "$p" ]] && continue
  [[ -n "$HOST_HARNESSES_ENV" ]] && HOST_HARNESSES_ENV="${HOST_HARNESSES_ENV},"
  HOST_HARNESSES_ENV="${HOST_HARNESSES_ENV}${b}:${p}"
done
echo "Harnesses resolved on host: ${HOST_HARNESSES_ENV:-none}"

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  echo "Building ${IMAGE}…"
  container build -t "$IMAGE" -c 4 -m 8G ${proxy_build_args[@]+"${proxy_build_args[@]}"} .
fi

state="$(container inspect "$NAME" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["status"] if d else "")' 2>/dev/null || true)"
if [[ -n "$state" ]]; then
  echo "Replacing existing container ${NAME} (${state})"
  container stop "$NAME" >/dev/null 2>&1 || true
  container rm "$NAME" >/dev/null 2>&1 || true
fi

echo "Starting ${NAME} on :${HOST_PORT}"
container run -d \
  --name "$NAME" \
  --cpus 2 \
  --memory 2G \
  --network default \
  -e "DATABASE_URL=${database_url}" \
  -e "SESSION_SECRET=${SESSION_SECRET}" \
  -e "HIVEMIND_HOST_HARNESSES=${HOST_HARNESSES_ENV}" \
  ${proxy_env[@]+"${proxy_env[@]}"} \
  -e NODE_ENV=production \
  -e HOSTNAME=0.0.0.0 \
  -e PORT=3000 \
  -p "${HOST_PORT}:3000" \
  "$IMAGE"

echo "Waiting for http://127.0.0.1:${HOST_PORT}/api/health …"
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null 2>&1; then
    echo "Hivemind is up: http://127.0.0.1:${HOST_PORT}"
    curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health"
    echo
    exit 0
  fi
  sleep 1
done

echo "App did not become ready in time. Logs:" >&2
container logs "$NAME" >&2 || true
exit 1
