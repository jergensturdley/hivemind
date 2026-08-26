#!/usr/bin/env bash
# Start Hivemind's Postgres 16 instance via Apple's `container` CLI.
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="${HIVEMIND_PG_NAME:-hivemind-pg}"
VOLUME="${HIVEMIND_PG_VOLUME:-hivemind-pg-data}"
IMAGE="${HIVEMIND_PG_IMAGE:-postgres:16}"
USER_NAME="${POSTGRES_USER:-postgres}"
PASSWORD="${POSTGRES_PASSWORD:-postgres}"
DB_NAME="${POSTGRES_DB:-app_db}"
HOST_PORT="${HIVEMIND_PG_PORT:-5432}"

if ! command -v container >/dev/null 2>&1; then
  echo "Apple container CLI not found. Install it, then re-run." >&2
  exit 1
fi

if ! container system status 2>/dev/null | grep -q '^status[[:space:]]\+running'; then
  echo "Starting Apple container system…"
  container system start
fi

if ! container volume ls | awk 'NR>1 {print $1}' | grep -qx "$VOLUME"; then
  echo "Creating volume $VOLUME"
  container volume create -s 10G "$VOLUME"
fi

state="$(container inspect "$NAME" 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["status"] if d else "")' 2>/dev/null || true)"

if [[ "$state" == "running" ]]; then
  echo "$NAME is already running"
elif [[ -n "$state" ]]; then
  echo "Starting existing container $NAME"
  container start "$NAME"
else
  echo "Creating $NAME from $IMAGE"
  container run -d \
    --name "$NAME" \
    --cpus 2 \
    --memory 2G \
    -e "POSTGRES_USER=$USER_NAME" \
    -e "POSTGRES_PASSWORD=$PASSWORD" \
    -e "POSTGRES_DB=$DB_NAME" \
    -e PGDATA=/var/lib/postgresql/data/pgdata \
    -p "${HOST_PORT}:5432" \
    -v "${VOLUME}:/var/lib/postgresql/data" \
    "$IMAGE"
fi

echo "Waiting for Postgres on 127.0.0.1:${HOST_PORT}…"
for _ in $(seq 1 30); do
  if node -e "
    const {Client}=require('pg');
    const c=new Client({
      connectionString: 'postgresql://${USER_NAME}:${PASSWORD}@127.0.0.1:${HOST_PORT}/${DB_NAME}',
      connectionTimeoutMillis: 800,
    });
    c.connect().then(()=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1));
  " >/dev/null 2>&1; then
    echo "Postgres is ready: postgresql://${USER_NAME}@127.0.0.1:${HOST_PORT}/${DB_NAME}"
    exit 0
  fi
  sleep 1
done

echo "Postgres did not become ready in time. Logs:" >&2
container logs "$NAME" >&2 || true
exit 1
