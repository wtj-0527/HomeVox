import { describe, expect, it } from 'vitest'
import { buildWallShellModel } from './wallShell'

const rectangleWalls = [
  { x1: 0, y1: 0, x2: 100, y2: 0 },
  { x1: 100, y1: 0, x2: 100, y2: 80 },
  { x1: 100, y1: 80, x2: 0, y2: 80 },
  { x1: 0, y1: 80, x2: 0, y2: 0 },
]

describe('3D wall shell model', () => {
  it('normalizes a rectangular plan into four wall meshes and a fitted floor', () => {
    const model = buildWallShellModel(rectangleWalls, [], [])

    expect(model.walls).toHaveLength(4)
    expect(model.walls[0]).toMatchObject({ sourceIndex: 0, x: 0, z: -4, length: 10, rotationY: 0 })
    expect(model.walls[1].x).toBeCloseTo(5)
    expect(model.walls[1].z).toBeCloseTo(0)
    expect(model.walls[1].length).toBeCloseTo(8)
    expect(model.walls[1].rotationY).toBeCloseTo(-Math.PI / 2)
    expect(model.floor).toMatchObject({ width: 11, depth: 9 })
  })

  it('calculates diagonal wall length, center, and rotation from the edited segment', () => {
    const model = buildWallShellModel([{ x1: 10, y1: 20, x2: 40, y2: 60 }], [], [])

    expect(model.walls).toHaveLength(1)
    expect(model.walls[0].x).toBeCloseTo(0)
    expect(model.walls[0].z).toBeCloseTo(0)
    expect(model.walls[0].length).toBeCloseTo(10)
    expect(model.walls[0].rotationY).toBeCloseTo(-Math.atan2(40, 30))
  })

  it('ignores invalid and zero-length walls without producing non-finite geometry', () => {
    const model = buildWallShellModel(
      [
        { x1: 0, y1: 0, x2: 0, y2: 0 },
        { x1: 0, y1: 0, x2: Number.NaN, y2: 10 },
        { x1: 0, y1: 0, x2: 10, y2: 0 },
      ],
      [],
      [],
    )

    expect(model.walls).toHaveLength(1)
    expect(model.walls[0].sourceIndex).toBe(2)
    expect(Object.values(model.walls[0]).filter((value) => typeof value === 'number').every(Number.isFinite)).toBe(true)
  })

  it('places only finite door and window markers in the same normalized coordinates', () => {
    const model = buildWallShellModel(
      rectangleWalls,
      [
        { type: 'door', from: '客厅', to: '走廊', x: 50, y: 0 },
        { type: 'door-without-position' },
      ],
      [{ type: 'window', x: 100, y: 40 }],
    )

    expect(model.openings).toHaveLength(2)
    expect(model.openings[0]).toMatchObject({ kind: 'door', x: 0, z: -4, label: 'door · 客厅 → 走廊' })
    expect(model.openings[1]).toMatchObject({ kind: 'window', x: 5, z: 0, label: 'window' })
  })

  it('rejects finite inputs whose normalization would overflow', () => {
    const model = buildWallShellModel(
      [{ x1: 0, y1: 0, x2: Number.MIN_VALUE, y2: 0 }],
      [{ type: 'door', x: Number.MIN_VALUE, y: 0 }],
      [],
    )

    expect(model).toEqual({ walls: [], openings: [], floor: null, scale: null })
  })

  it('keeps all outputs finite for very large finite coordinates', () => {
    const start = Number.MAX_VALUE / 4
    const delta = 1e292
    const model = buildWallShellModel(
      [{ x1: start, y1: start, x2: start + delta, y2: start }],
      [{ type: 'door', x: start, y: start }],
      [],
    )

    expect(model.walls).toHaveLength(1)
    const numericValues = [
      model.scale,
      ...Object.values(model.walls[0]),
      ...Object.values(model.floor ?? {}),
      ...model.openings.flatMap((opening) => [opening.x, opening.z]),
    ].filter((value): value is number => typeof value === 'number')
    expect(numericValues.every(Number.isFinite)).toBe(true)
  })

  it('returns an explicit empty model when no valid walls exist', () => {
    const model = buildWallShellModel([], [{ type: 'door', x: 1, y: 2 }], [])

    expect(model.walls).toEqual([])
    expect(model.openings).toEqual([])
    expect(model.floor).toBeNull()
  })
})
