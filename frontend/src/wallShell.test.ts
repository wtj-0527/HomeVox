import { describe, expect, it } from 'vitest'
import { buildWallShellModel } from './wallShell'
import type { ParsedOpening } from './floorplanUi'

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

  it('keeps legacy parse-only markers out of durable opening geometry', () => {
    const model = buildWallShellModel(
      rectangleWalls,
      [{ type: 'door', from: '客厅', to: '走廊', x: 50, y: 0 }],
      [{ type: 'window', x: 100, y: 40 }],
    )

    expect(model.walls).toHaveLength(4)
    expect(model.openings).toEqual([])
    expect(model.validationError).toContain('opening id')
  })

  it.each<[string, ParsedOpening[], string]>([
    ['missing wall', [{ id: 'door-a', kind: 'door', wallId: 'missing', position: 0.5, width: 20 }], 'missing'],
    ['endpoint overflow', [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.05, width: 20 }], 'endpoint'],
    ['overlap', [
      { id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.45, width: 30 },
      { id: 'window-a', kind: 'window', wallId: 'wall-a', position: 0.55, width: 30 },
    ], 'overlap'],
    ['under-minimum width', [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.5, width: 7 }], 'invalid'],
    ['oversized opening', [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.5, width: 100 }], 'exceeds'],
  ])('fails closed for finite but illegal %s openings', (_caseName, openings, error) => {
    const model = buildWallShellModel([{ id: 'wall-a', x1: 0, y1: 0, x2: 100, y2: 0 }], openings, [])

    expect(model.walls).toHaveLength(1)
    expect(model.openings).toEqual([])
    expect(model.validationError).toContain(error)
  })

  it('fails closed for duplicate explicit wall IDs from a loaded opening document', () => {
    const model = buildWallShellModel(
      [
        { id: 'wall-a', x1: 0, y1: 0, x2: 100, y2: 0 },
        { id: 'wall-a', x1: 100, y1: 0, x2: 100, y2: 80 },
      ],
      [{ id: 'door-a', kind: 'door', wallId: 'wall-a', position: 0.5, width: 20 }],
      [],
    )

    expect(model.walls).toHaveLength(2)
    expect(model.openings).toEqual([])
    expect(model.validationError).toContain('wall id must be unique')
  })

  it('rejects finite inputs whose normalization would overflow', () => {
    const model = buildWallShellModel(
      [{ x1: 0, y1: 0, x2: Number.MIN_VALUE, y2: 0 }],
      [{ type: 'door', x: Number.MIN_VALUE, y: 0 }],
      [],
    )

    expect(model).toEqual({ walls: [], openings: [], floor: null, scale: null, validationError: null })
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
