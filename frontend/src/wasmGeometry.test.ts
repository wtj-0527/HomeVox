import { describe, expect, it } from 'vitest'
import { buildWasmWallGeometry, disposeWasmWallGeometry } from './wasmGeometry'
import type { WallVoxelModel } from './wallVoxel'

const model: WallVoxelModel = {
  dimensions: [2, 2, 2],
  data: new Float32Array(8),
  isoLevel: 0,
  origin: [10, 20, 30],
  spacing: [2, 3, 4],
}

describe('WASM BufferGeometry lifecycle', () => {
  it('maps grid XYZ to finite positions and disposes replacement geometry', () => {
    const geometry = buildWasmWallGeometry(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), model)
    expect(geometry).not.toBeNull()
    expect(Array.from(geometry!.getAttribute('position').array)).toEqual([10, 20, 30, 12, 20, 30, 10, 23, 30])
    expect(Array.from(geometry!.getAttribute('normal').array).every(Number.isFinite)).toBe(true)

    let disposed = false
    geometry!.addEventListener('dispose', () => { disposed = true })
    disposeWasmWallGeometry(geometry)
    expect(disposed).toBe(true)
  })

  it('rejects malformed output', () => {
    expect(buildWasmWallGeometry(new Float32Array([0, Number.NaN, 0]), model)).toBeNull()
  })
})
