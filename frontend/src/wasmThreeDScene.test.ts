import { BufferGeometry } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { nearestWasmWallID, wasmWallMeshPresentation } from './wasmThreeDScene'
import type { WallShellModel } from './wallShell'

const model: WallShellModel = {
  walls: [
    { id: 'wall-a', sourceIndex: 0, x: 0, z: 0, length: 6, height: 2.8, thickness: 0.18, rotationY: 0 },
    { id: 'wall-b', sourceIndex: 1, x: 3, z: 2, length: 4, height: 2.8, thickness: 0.18, rotationY: -Math.PI / 2 },
  ],
  openings: [],
  floor: { x: 0, z: 0, width: 8, depth: 6 },
  scale: 1,
  validationError: null,
}

describe('visible WASM 3D scene contract', () => {
  it('uses the generated WASM BufferGeometry as the visible and interactive wall mesh', () => {
    const geometry = new BufferGeometry()
    const onSelectWall = vi.fn()
    const presentation = wasmWallMeshPresentation(true, geometry, model, onSelectWall)

    expect(presentation).not.toBeNull()
    expect(presentation).toMatchObject({ geometry, visible: true, castShadow: true, receiveShadow: true })
    presentation!.onSelectAt(0.5, 0)
    expect(onSelectWall).toHaveBeenCalledWith('wall-a')
  })

  it('does not expose a success-path mesh without active WASM geometry', () => {
    expect(wasmWallMeshPresentation(false, new BufferGeometry(), model, vi.fn())).toBeNull()
    expect(wasmWallMeshPresentation(true, null, model, vi.fn())).toBeNull()
  })

  it('maps a WASM surface click back to its canonical wall identity', () => {
    expect(nearestWasmWallID(model, 2.5, 0.03)).toBe('wall-a')
    expect(nearestWasmWallID(model, 3.02, 2.7)).toBe('wall-b')
  })
})

