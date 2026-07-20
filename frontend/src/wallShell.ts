import type { WallSegment } from './floorplanEditor'
import { openingLabel, type ParsedOpening } from './floorplanUi'

export const WALL_SHELL_HEIGHT = 2.8
export const WALL_SHELL_THICKNESS = 0.18
export const WALL_SHELL_TARGET_SPAN = 10
export const WALL_SHELL_FLOOR_MARGIN = 1

export type WallShellWall = {
  sourceIndex: number
  x: number
  z: number
  length: number
  height: number
  thickness: number
  rotationY: number
}

export type WallShellOpening = {
  kind: 'door' | 'window'
  sourceIndex: number
  x: number
  z: number
  label: string | null
}

export type WallShellFloor = {
  x: number
  z: number
  width: number
  depth: number
}

export type WallShellModel = {
  walls: WallShellWall[]
  openings: WallShellOpening[]
  floor: WallShellFloor | null
  scale: number | null
}

type ValidWall = WallSegment & {
  sourceIndex: number
  sourceLength: number
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validWalls(walls: readonly WallSegment[]): ValidWall[] {
  const result: ValidWall[] = []
  walls.forEach((wall, sourceIndex) => {
    if (![wall.x1, wall.y1, wall.x2, wall.y2].every(isFiniteNumber)) return
    const sourceLength = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1)
    if (!Number.isFinite(sourceLength) || sourceLength <= 0) return
    result.push({ ...wall, sourceIndex, sourceLength })
  })
  return result
}

function emptyWallShellModel(): WallShellModel {
  return { walls: [], openings: [], floor: null, scale: null }
}

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

export function buildWallShellModel(
  walls: readonly WallSegment[],
  doors: readonly ParsedOpening[],
  windows: readonly ParsedOpening[],
): WallShellModel {
  const valid = validWalls(walls)
  if (valid.length === 0) {
    return emptyWallShellModel()
  }

  const xs = valid.flatMap((wall) => [wall.x1, wall.x2])
  const ys = valid.flatMap((wall) => [wall.y1, wall.y2])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const sourceSpan = Math.max(
    maxX - minX,
    maxY - minY,
    ...valid.map((wall) => wall.sourceLength),
  )
  const scale = WALL_SHELL_TARGET_SPAN / sourceSpan
  if (!allFinite([minX, maxX, minY, maxY, centerX, centerY, sourceSpan, scale]) || sourceSpan <= 0 || scale <= 0) {
    return emptyWallShellModel()
  }

  const normalizedWalls = valid.map((wall): WallShellWall => {
    const dx = wall.x2 - wall.x1
    const dy = wall.y2 - wall.y1
    const rawRotationY = -Math.atan2(dy, dx)
    return {
      sourceIndex: wall.sourceIndex,
      x: ((wall.x1 + wall.x2) / 2 - centerX) * scale,
      z: ((wall.y1 + wall.y2) / 2 - centerY) * scale,
      length: wall.sourceLength * scale,
      height: WALL_SHELL_HEIGHT,
      thickness: WALL_SHELL_THICKNESS,
      rotationY: Object.is(rawRotationY, -0) ? 0 : rawRotationY,
    }
  })

  const floor: WallShellFloor = {
    x: 0,
    z: 0,
    width: (maxX - minX) * scale + WALL_SHELL_FLOOR_MARGIN,
    depth: (maxY - minY) * scale + WALL_SHELL_FLOOR_MARGIN,
  }
  const wallsAreFinite = normalizedWalls.every((wall) =>
    allFinite([wall.x, wall.z, wall.length, wall.height, wall.thickness, wall.rotationY]),
  )
  if (!wallsAreFinite || !allFinite([floor.x, floor.z, floor.width, floor.depth])) {
    return emptyWallShellModel()
  }

  const normalizedOpenings: WallShellOpening[] = []
  const appendOpenings = (items: readonly ParsedOpening[], kind: 'door' | 'window') => {
    items.forEach((opening, sourceIndex) => {
      if (!isFiniteNumber(opening.x) || !isFiniteNumber(opening.y)) return
      const x = (opening.x - centerX) * scale
      const z = (opening.y - centerY) * scale
      if (!allFinite([x, z])) return
      normalizedOpenings.push({
        kind,
        sourceIndex,
        x,
        z,
        label: openingLabel(opening),
      })
    })
  }
  appendOpenings(doors, 'door')
  appendOpenings(windows, 'window')

  return {
    walls: normalizedWalls,
    openings: normalizedOpenings,
    floor,
    scale,
  }
}
