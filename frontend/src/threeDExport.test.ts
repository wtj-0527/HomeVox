import { describe, expect, it } from 'vitest'
import { canExportCurrentThreeD } from './threeDExport'

const ready = { isExporting: false, hasModel: true, webGLAvailable: true, wasmActive: true, hasWasmGeometry: true, rendererMounted: true, rendererGeneration: 'r4', geometryGeneration: 'r4', canonicalGeneration: 'r4' }
describe('3D export admission', () => {
  it('requires current WASM geometry and its mounted renderer', () => {
    expect(canExportCurrentThreeD(ready)).toBe(true)
    expect(canExportCurrentThreeD({ ...ready, wasmActive: false })).toBe(false)
    expect(canExportCurrentThreeD({ ...ready, hasWasmGeometry: false })).toBe(false)
    expect(canExportCurrentThreeD({ ...ready, rendererMounted: false })).toBe(false)
    expect(canExportCurrentThreeD({ ...ready, rendererGeneration: 'r3' })).toBe(false)
    expect(canExportCurrentThreeD({ ...ready, geometryGeneration: 'r3' })).toBe(false)
    expect(canExportCurrentThreeD({ ...ready, canonicalGeneration: null })).toBe(false)
  })
})
