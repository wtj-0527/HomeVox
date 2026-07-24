import { describe, expect, it } from 'vitest'
import { buildWallVoxelModel, WALL_VOXEL_GRID_SIZE } from './wallVoxel'
import type { ParsedOpening } from './floorplanUi'

function voxelAt(model: NonNullable<ReturnType<typeof buildWallVoxelModel>>, xIndex: number, yIndex: number, zIndex: number): number {
  const [nx, ny] = model.dimensions
  return model.data[xIndex + yIndex * nx + zIndex * nx * ny]
}

describe('buildWallVoxelModel', () => {
  it('creates a finite, controlled 17³ field from editable walls', () => {
    const model = buildWallVoxelModel([{ x1: 0, y1: 0, x2: 300, y2: 0 }])

    expect(model).not.toBeNull()
    expect(model?.dimensions).toEqual([WALL_VOXEL_GRID_SIZE, WALL_VOXEL_GRID_SIZE, WALL_VOXEL_GRID_SIZE])
    expect(model?.data).toHaveLength(WALL_VOXEL_GRID_SIZE ** 3)
    expect(Array.from(model?.data ?? []).every(Number.isFinite)).toBe(true)
    expect(model?.spacing.every((value) => value > 0)).toBe(true)
  })

  it('rejects empty, non-finite, and degenerate walls', () => {
    expect(buildWallVoxelModel([])).toBeNull()
    expect(buildWallVoxelModel([{ x1: 0, y1: 0, x2: 0, y2: 0 }])).toBeNull()
    expect(buildWallVoxelModel([{ x1: 0, y1: 0, x2: Number.NaN, y2: 1 }])).toBeNull()
  })

  it.each<[string, ParsedOpening[]]>([
    ['missing wall', [{ id: 'door-a', kind: 'door', wallId: 'missing', position: 0.5, width: 20 }]],
    ['endpoint overflow', [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.05, width: 20 }]],
    ['overlap', [
      { id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.45, width: 30 },
      { id: 'window-a', kind: 'window', wallId: 'wall-a', position: 0.55, width: 30 },
    ]],
    ['under-minimum width', [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.5, width: 7 }]],
    ['oversized opening', [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.5, width: 100 }]],
  ])('does not build a voxel field for finite but illegal %s openings', (_caseName, openings) => {
    expect(buildWallVoxelModel([{ id: 'wall-a', x1: 0, y1: 0, x2: 100, y2: 0 }], openings)).toBeNull()
  })

  it('does not build a voxel/WASM input field for duplicate explicit wall IDs', () => {
    expect(buildWallVoxelModel(
      [
        { id: 'wall-a', x1: 0, y1: 0, x2: 100, y2: 0 },
        { id: 'wall-a', x1: 100, y1: 0, x2: 100, y2: 80 },
      ],
      [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.5, width: 20 }],
    )).toBeNull()
  })

  it('subtracts a vertical wall door along the wall tangent rather than world X', () => {
    const model = buildWallVoxelModel(
      [{ id: 'vertical', x1: 0, y1: 0, x2: 0, y2: 300 }],
      [{ id: 'door-vertical', wallId: 'vertical', position: 0.7, width: 60, kind: 'door' }],
    )

    expect(model).not.toBeNull()
    // x=0, z≈2.68 is inside the wall-local door span but outside a world-X cut.
    expect(voxelAt(model!, 8, 7, 12)).toBeLessThan(0)
  })

  it('subtracts a diagonal wall door along the wall tangent rather than world axes', () => {
    const model = buildWallVoxelModel(
      [{ id: 'diagonal', x1: 0, y1: 0, x2: 300, y2: 300 }],
      [{ id: 'door-diagonal', wallId: 'diagonal', position: 0.7, width: 80, kind: 'door' }],
    )

    expect(model).not.toBeNull()
    // x=z≈2.01 is inside the diagonal wall-local door span but outside a world-axis cut.
    expect(voxelAt(model!, 11, 7, 11)).toBeLessThan(0)
  })

  it('cuts a finite window opening from the wall field rather than only adding a marker', () => {
    const walls = [{ id: 'wall-a', x1: 0, y1: 0, x2: 300, y2: 0 }]
    const solid = buildWallVoxelModel(walls)
    const withWindow = buildWallVoxelModel(
      walls,
      [],
      [{ id: 'window-a', kind: 'window', wallId: 'wall-a', position: 0.5, width: 70, confirmed: false }],
    )

    expect(solid).not.toBeNull()
    expect(withWindow).not.toBeNull()
    expect(Array.from(withWindow!.data).every(Number.isFinite)).toBe(true)
    expect(Array.from(withWindow!.data)).not.toEqual(Array.from(solid!.data))
  })

  it('keeps multiple legal near-end openings finite while changing the generated field', () => {
    const walls = [{ id: 'wall-a', x1: 0, y1: 0, x2: 300, y2: 0 }]
    const oneOpening = buildWallVoxelModel(
      walls,
      [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.15, width: 60, confirmed: false }],
    )
    const multipleOpenings = buildWallVoxelModel(
      walls,
      [
        { id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.15, width: 60, confirmed: false },
        { id: 'door-b', kind: 'door', wallId: 'wall-a', position: 0.85, width: 60, confirmed: false },
      ],
      [{ id: 'window-a', kind: 'window', wallId: 'wall-a', position: 0.5, width: 60, confirmed: false }],
    )

    expect(oneOpening).not.toBeNull()
    expect(multipleOpenings).not.toBeNull()
    expect(Array.from(multipleOpenings!.data).every(Number.isFinite)).toBe(true)
    expect(Array.from(multipleOpenings!.data)).not.toEqual(Array.from(oneOpening!.data))
  })

  it('fails closed for non-finite opening data', () => {
    expect(buildWallVoxelModel(
      [{ id: 'wall-a', x1: 0, y1: 0, x2: 300, y2: 0 }],
      [{ id: 'invalid', kind: 'door', wallId: 'wall-a', position: Number.NaN, width: 60 }],
    )).toBeNull()
  })
})
