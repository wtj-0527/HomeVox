import type { WasmBindings } from './wasmMarchingCubes'

declare global {
  interface Window {
    __homevoxE2E?: unknown
  }
}

function enabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('e2e')
}

export function isE2EInstrumentationEnabled(): boolean {
  return enabled()
}

export function e2EProjectID(): string | null {
  if (!enabled()) return null
  const value = new URLSearchParams(window.location.search).get('project')
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
}

export function e2EWasmLoader(): (() => Promise<WasmBindings>) | undefined {
  if (enabled() && new URLSearchParams(window.location.search).get('wasm') === 'load-failure') {
    return async () => { throw new Error('test-only WASM loader failure') }
  }
  return undefined
}

export function publishE2EState(state: unknown): void {
  if (enabled()) window.__homevoxE2E = state
}
