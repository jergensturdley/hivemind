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
database_url="postgresql://${USER_NAME}:${PASSWORD}@${pg_ip}:5432/${DB_NAME}"
echo "App will reach Postgres at ${pg_ip}:5432"

if ! container builder status 2>/dev/null | grep -qi running; then
  echo "Starting Apple container builder…"
  container builder start -c 4 -m 8G
fi

if [[ "${SKIP_BUILD:-}" != "1" ]]; then
  echo "Building ${IMAGE}…"
  container build -t "$IMAGE" -c 4 -m 8G .
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
