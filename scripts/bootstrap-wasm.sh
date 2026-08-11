#!/usr/bin/env bash
set -euo pipefail

readonly RUST_TOOLCHAIN="1.96.1"
readonly WASM_PACK_VERSION="0.13.1"

# Avoid an unnecessary network refresh when the pinned compiler is already
# installed. A clean environment still installs the exact pinned toolchain.
if ! rustup run "$RUST_TOOLCHAIN" rustc --version >/dev/null 2>&1; then
  rustup toolchain install "$RUST_TOOLCHAIN" --profile minimal
fi
if ! rustup target list --toolchain "$RUST_TOOLCHAIN" --installed | grep -qx 'wasm32-unknown-unknown'; then
  rustup target add wasm32-unknown-unknown --toolchain "$RUST_TOOLCHAIN"
fi

if ! command -v wasm-pack >/dev/null 2>&1 || ! wasm-pack --version | grep -qx "wasm-pack ${WASM_PACK_VERSION}"; then
  cargo +"$RUST_TOOLCHAIN" install wasm-pack --version "$WASM_PACK_VERSION" --locked
fi

rustup run "$RUST_TOOLCHAIN" rustc --version
wasm-pack --version
