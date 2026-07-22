#!/usr/bin/env bash
set -euo pipefail

readonly RUST_TOOLCHAIN="1.96.1"
readonly WASM_PACK_VERSION="0.13.1"

rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal
rustup target add wasm32-unknown-unknown --toolchain "$RUST_TOOLCHAIN"

if ! command -v wasm-pack >/dev/null 2>&1 || ! wasm-pack --version | grep -qx "wasm-pack ${WASM_PACK_VERSION}"; then
  cargo +"$RUST_TOOLCHAIN" install wasm-pack --version "$WASM_PACK_VERSION" --locked
fi

wasm-pack --version
