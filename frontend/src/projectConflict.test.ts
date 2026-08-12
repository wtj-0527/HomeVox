import { describe, expect, it } from 'vitest'
import { buildProjectConflict, resolveProjectConflictDocument } from './projectConflict'
import type { ParseResponse } from './floorplanUi'

const base: ParseResponse = {
  filename: 'plan.png', contentType: 'image/png', size: 3,
  result: {
    rooms: [],
    walls: [
      { id: 'wall-a', x1: 10, y1: 0, x2: 40, y2: 0 },
      { id: 'wall-b', x1: 40, y1: 0, x2: 40, y2: 30 },
    ],
    doors: [], windows: [],
    scale: { unit: 'px', pixel_to_unit: null },
    metadata: { source: 'fixture', confidence: .5, image_width: 100, image_height: 80 },
  },
}

const change = (document: ParseResponse, wallID: string, patch: Record<string, number>): ParseResponse => ({
  ...document,
  result: { ...document.result, walls: document.result.walls.map((wall) => wall.id === wallID ? { ...wall, ...patch } : wall) },
})

describe('D1.3 object conflict model', () => {
  it('automatically combines non-overlapping stable-object fields', () => {
    const local = change(base, 'wall-a', { x1: 11 })
    const remote = change(base, 'wall-b', { y2: 31 })
    const conflict = buildProjectConflict(base, local, remote)
    expect(conflict.items).toEqual([])
    expect(resolveProjectConflictDocument(conflict)).toEqual(change(change(base, 'wall-a', { x1: 11 }), 'wall-b', { y2: 31 }))
  })

  it('requires an explicit choice for every overlapping field', () => {
    const local = change(base, 'wall-a', { x1: 11, y1: 1 })
    const remote = change(base, 'wall-a', { x1: 12, y1: 2 })
    const conflict = buildProjectConflict(base, local, remote)
    expect(conflict.items.map((item) => item.id)).toEqual(['walls:wall-a:x1', 'walls:wall-a:y1'])
    expect(resolveProjectConflictDocument(conflict)).toBeNull()
    conflict.items[0].choice = 'local'
    expect(resolveProjectConflictDocument(conflict)).toBeNull()
    conflict.items[1].choice = 'remote'
    expect(resolveProjectConflictDocument(conflict)?.result.walls[0]).toMatchObject({ x1: 11, y1: 2 })
  })
})
