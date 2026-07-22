#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_LOG="$(mktemp)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

npm --prefix "$ROOT/frontend" run build
(
  cd "$ROOT/backend"
  HOMEVOX_FRONTEND_DIR="$ROOT/frontend/dist" go run ./cmd/server
) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:18088/api/health >/dev/null; then
    HOMEVOX_E2E_BASE_URL=http://127.0.0.1:18088 \
      npm --prefix "$ROOT/frontend" exec -- playwright test --config playwright.config.ts
    exit 0
  fi
  sleep 1
done

cat "$SERVER_LOG" >&2
exit 1
