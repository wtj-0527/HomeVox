#!/usr/bin/env bash
set -euo pipefail

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bootstrap-wasm.sh"
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../wasm" && pwd)"
wasm-pack build --target web --out-dir pkg
