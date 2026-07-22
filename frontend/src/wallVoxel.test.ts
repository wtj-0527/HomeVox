import { describe, expect, it } from 'vitest'
import { buildWallVoxelModel, WALL_VOXEL_GRID_SIZE } from './wallVoxel'

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
})
