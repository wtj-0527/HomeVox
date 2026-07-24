#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}"
SUFFIX="browser-$(date +%s)-$$"
NET="homevox-e2e-${SUFFIX}-net"
PG="homevox-e2e-${SUFFIX}-pg"
MINIO="homevox-e2e-${SUFFIX}-minio"
MC="homevox-e2e-${SUFFIX}-mc"
RUN="homevox-e2e-${SUFFIX}-runner"
BROWSER="homevox-e2e-${SUFFIX}-browser"
test -d "$TMP_ROOT" && test -w "$TMP_ROOT" || {
  echo "temporary directory is not writable: $TMP_ROOT" >&2
  exit 1
}
OUT="$(mktemp -d "${TMP_ROOT%/}/homevox-browser-e2e-${SUFFIX}.XXXXXX")"

cleanup() {
  local cleanup_status=0
  docker rm -f "$BROWSER" "$RUN" "$MC" "$MINIO" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  for resource in "$BROWSER" "$RUN" "$MC" "$MINIO" "$PG"; do
    if docker container inspect "$resource" >/dev/null 2>&1; then
      echo "cleanup=FAIL container remains: $resource" >&2
      cleanup_status=1
    fi
  done
  if docker network inspect "$NET" >/dev/null 2>&1; then
    echo "cleanup=FAIL resources remain for $SUFFIX" >&2
    cleanup_status=1
  fi
  if [[ "${HOMEVOX_KEEP_E2E_ARTIFACTS:-0}" == "1" ]]; then
    echo "artifacts=KEPT path=$OUT"
  else
    rm -rf -- "$OUT" || cleanup_status=1
    if test -e "$OUT"; then
      echo "artifacts_cleanup=FAIL path=$OUT" >&2
      cleanup_status=1
    else
      echo "artifacts_cleanup=PASS"
    fi
  fi
  if (( cleanup_status == 0 )); then
    echo "cleanup=PASS suffix=$SUFFIX"
  fi
  return "$cleanup_status"
}
trap cleanup EXIT

for resource in "$PG" "$MINIO" "$MC" "$RUN" "$BROWSER"; do
  ! docker container inspect "$resource" >/dev/null 2>&1 || { echo "refusing existing container $resource" >&2; exit 1; }
done
! docker network inspect "$NET" >/dev/null 2>&1 || { echo "refusing existing network $NET" >&2; exit 1; }

npm --prefix "$ROOT/frontend" run build
(
  cd "$ROOT/backend"
  CGO_ENABLED=0 go build -o "$OUT/homevox-server" ./cmd/server
  CGO_ENABLED=0 go build -o "$OUT/fake-vision" ./cmd/fake-vision
)

docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" -e POSTGRES_USER=homevox -e POSTGRES_PASSWORD=e2e_local_only -e POSTGRES_DB=homevox postgres:16-alpine >/dev/null
docker run -d --name "$MINIO" --network "$NET" -e MINIO_ROOT_USER=homevox_e2e -e MINIO_ROOT_PASSWORD=e2e_local_only_secret minio/minio:latest server /data >/dev/null
docker run -d --name "$RUN" --network "$NET" alpine:3.20 sh -c 'while :; do sleep 3600; done' >/dev/null

for i in $(seq 1 60); do
  docker exec "$PG" pg_isready -U homevox -d homevox >/dev/null 2>&1 && break
  test "$i" -lt 60 || { echo postgres_ready=FAIL >&2; exit 1; }
  sleep 1
done
echo postgres_ready=PASS
for i in $(seq 1 60); do
  if docker run --rm --name "$MC" --network "$NET" --entrypoint /bin/sh minio/mc:latest -c "mc alias set local http://$MINIO:9000 homevox_e2e e2e_local_only_secret >/dev/null 2>&1 && mc mb --ignore-existing local/homevox >/dev/null 2>&1"; then break; fi
  test "$i" -lt 60 || { echo minio_bucket_ready=FAIL >&2; exit 1; }
  sleep 1
done
echo minio_bucket_ready=PASS

docker exec "$RUN" mkdir -p /app/frontend
docker cp "$OUT/homevox-server" "$RUN":/app/homevox-server
docker cp "$OUT/fake-vision" "$RUN":/app/fake-vision
docker cp "$ROOT/frontend/dist/." "$RUN":/app/frontend/
docker exec "$RUN" chmod 755 /app/homevox-server /app/fake-vision
docker exec "$RUN" sh -c "/app/fake-vision >/app/fake-vision.log 2>&1 & echo \$! >/app/fake-vision.pid"
docker exec "$RUN" sh -c "DATABASE_URL='postgres://homevox:e2e_local_only@$PG:5432/homevox?sslmode=disable' S3_ENDPOINT='http://$MINIO:9000' S3_BUCKET=homevox S3_ACCESS_KEY_ID=homevox_e2e S3_SECRET_ACCESS_KEY=e2e_local_only_secret AI_BASE_URL='http://127.0.0.1:18089/v1' AI_API_KEY=e2e-fake-key AI_MODEL=e2e-fake-vision HOMEVOX_FRONTEND_DIR=/app/frontend /app/homevox-server >/app/server.log 2>&1 & echo \$! >/app/server.pid"

listening() {
  docker exec "$RUN" sh -c 'for f in /proc/net/tcp /proc/net/tcp6; do while read sl local remote state rest; do case "$local:$state" in *:46A8:0A) exit 0;; esac; done < "$f"; done; exit 1'
}
for i in $(seq 1 60); do
  listening && break
  test "$i" -lt 60 || { docker exec "$RUN" cat /app/server.log >&2; echo server_listen=FAIL >&2; exit 1; }
  sleep 1
done
echo server_listen_0.0.0.0_18088=PASS

# The browser is network-isolated with the server; source, dependencies and assets
# are copied rather than bind-mounted so this works against a remote Docker daemon.
docker create --name "$BROWSER" --network "$NET" -e "HOMEVOX_E2E_BASE_URL=http://$RUN:18088" -w /work/frontend mcr.microsoft.com/playwright:v1.61.1-noble bash -lc 'npx playwright test --config playwright.config.ts' >/dev/null
docker cp "$ROOT/frontend/." "$BROWSER":/work/frontend/
docker start -a "$BROWSER"
echo production_browser_persistence_e2e=PASS exact_head=$(git -C "$ROOT" rev-parse HEAD) network=$NET
