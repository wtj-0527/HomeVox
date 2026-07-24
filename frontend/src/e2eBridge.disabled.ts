import type { WasmBindings } from './wasmMarchingCubes'

export function isE2EInstrumentationEnabled(): boolean { return false }
export function e2EProjectID(): string | null { return null }
export function e2EWasmLoader(): (() => Promise<WasmBindings>) | undefined { return undefined }
export function publishE2EState(_state: unknown): void {}
