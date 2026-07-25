import type { WallSegment } from './floorplanEditor'
import { openingLabel, validateCanonicalFloorplan, type ParsedOpening } from './floorplanUi'

export const WALL_SHELL_HEIGHT = 2.8
export const WALL_SHELL_THICKNESS = 0.18
export const WALL_SHELL_TARGET_SPAN = 10
export const WALL_SHELL_FLOOR_MARGIN = 1
export const WINDOW_SILL_HEIGHT = 0.92
export const WINDOW_OPENING_HEIGHT = 1.12

export type WallShellWall = {
  id: string
  sourceIndex: number
  x: number
  z: number
  length: number
  height: number
  thickness: number
  rotationY: number
}

export type WallShellOpening = {
  id: string
  wallId: string
  kind: 'door' | 'window'
  sourceIndex: number
  width: number
  x: number
  z: number
  rotationY: number
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
  /** Canonical opening validation error; geometry consumers must fail closed. */
  validationError: string | null
}

export type WallShellPiece = {
  id: string
  wallId: string
  x: number
  y: number
  z: number
  length: number
  height: number
  thickness: number
  rotationY: number
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
  return { walls: [], openings: [], floor: null, scale: null, validationError: null }
}

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

export function buildWallShellModel(
  walls: readonly WallSegment[],
  doors: readonly ParsedOpening[],
  windows: readonly ParsedOpening[],
): WallShellModel {
  const validationError = validateCanonicalFloorplan(walls, [...doors, ...windows])
  if (validationError) {
    return { ...emptyWallShellModel(), validationError }
  }

  const valid = validWalls(walls)
  if (valid.length === 0) {
    return { ...emptyWallShellModel(), validationError: 'floorplan must contain at least one wall' }
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
      id: wall.id ?? `wall-${wall.sourceIndex + 1}`,
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
  const wallByID = new Map(valid.map((wall) => [wall.id ?? `wall-${wall.sourceIndex + 1}`, wall]))
  const normalizedWallBySourceIndex = new Map(normalizedWalls.map((wall) => [wall.sourceIndex, wall]))
  const appendOpenings = (items: readonly ParsedOpening[], kind: 'door' | 'window') => {
    items.forEach((opening, sourceIndex) => {
      const wall = opening.wallId ? wallByID.get(opening.wallId) : undefined
      const openingKind = opening.kind ?? kind
      const normalizedWall = wall ? normalizedWallBySourceIndex.get(wall.sourceIndex) : undefined
      if (wall && normalizedWall && opening.id && opening.wallId && isFiniteNumber(opening.position) && isFiniteNumber(opening.width) && openingKind === kind) {
        const sourceX = wall.x1 + (wall.x2 - wall.x1) * opening.position
        const sourceY = wall.y1 + (wall.y2 - wall.y1) * opening.position
        const x = (sourceX - centerX) * scale
        const z = (sourceY - centerY) * scale
        if (!allFinite([x, z, opening.width * scale])) return
        normalizedOpenings.push({
          id: opening.id,
          wallId: opening.wallId,
          kind,
          sourceIndex,
          width: opening.width * scale,
          x,
          z,
          rotationY: normalizedWall.rotationY,
          label: openingLabel(opening),
        })
        return
      }
      // Legacy absolute markers are parse-preview only and are never accepted by persistence.
      if (!isFiniteNumber(opening.x) || !isFiniteNumber(opening.y)) return
      const x = (opening.x - centerX) * scale; const z = (opening.y - centerY) * scale
      if (!allFinite([x, z])) return
      normalizedOpenings.push({
        id: `legacy-${kind}-${sourceIndex}`,
        wallId: '',
        kind,
        sourceIndex,
        width: 0,
        x,
        z,
        rotationY: 0,
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
    validationError: null,
  }
}

export type ThreeDFrame = {
  position: readonly [number, number, number]
  target: readonly [number, number, number]
  floorSpan: number
}

/** Camera derived from normalized floorplan bounds and the actual canvas aspect
 * ratio. The previous fixed-distance framing made a valid floorplan occupy too
 * little of Step 4/5 on production layouts. */
export function frameWallShellModel(model: WallShellModel, aspectRatio = 16 / 9): ThreeDFrame {
  const floorSpan = Math.max(model.floor?.width ?? 0, model.floor?.depth ?? 0, 1)
  const aspect = Number.isFinite(aspectRatio) ? Math.min(2.6, Math.max(0.8, aspectRatio)) : 16 / 9
  const horizontalDistance = floorSpan * (aspect >= 1.2 ? 0.92 : 1.06) + WALL_SHELL_HEIGHT * 0.55
  const elevation = Math.max(WALL_SHELL_HEIGHT * 2.25, floorSpan * 0.58 + WALL_SHELL_HEIGHT * 0.7)
  return {
    position: [horizontalDistance, elevation, horizontalDistance],
    target: [0, WALL_SHELL_HEIGHT * 0.38, 0],
    floorSpan,
  }
}

/** Builds visible wall spans from canonical openings.  The renderer uses these
 * pieces instead of a translucent solid selection shell, so door/window holes
 * remain visible even while a wall is selected. */
export function buildWallShellPieces(model: WallShellModel): WallShellPiece[] {
  const openingsByWall = new Map<string, WallShellOpening[]>()
  for (const opening of model.openings) {
    if (!opening.wallId || opening.width <= 0) continue
    openingsByWall.set(opening.wallId, [...(openingsByWall.get(opening.wallId) ?? []), opening])
  }

  return model.walls.flatMap((wall) => {
    const intervals = (openingsByWall.get(wall.id) ?? [])
      .map((opening) => {
        const center = (opening.x - wall.x) * Math.cos(wall.rotationY) - (opening.z - wall.z) * Math.sin(wall.rotationY)
        return {
          start: Math.max(-wall.length / 2, center - opening.width / 2),
          end: Math.min(wall.length / 2, center + opening.width / 2),
        }
      })
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start)

    const solidSpans: Array<{ start: number; end: number }> = []
    let cursor = -wall.length / 2
    for (const interval of intervals) {
      if (interval.start > cursor) solidSpans.push({ start: cursor, end: interval.start })
      cursor = Math.max(cursor, interval.end)
    }
    if (cursor < wall.length / 2) solidSpans.push({ start: cursor, end: wall.length / 2 })

    const fullHeightPiece = (id: string, span: { start: number; end: number }): WallShellPiece => {
      const along = (span.start + span.end) / 2
      return {
        id,
        wallId: wall.id,
        x: wall.x + Math.cos(wall.rotationY) * along,
        y: wall.height / 2,
        z: wall.z - Math.sin(wall.rotationY) * along,
        length: span.end - span.start,
        height: wall.height,
        thickness: wall.thickness,
        rotationY: wall.rotationY,
      }
    }
    const pieces = solidSpans.map((span, index) => fullHeightPiece(`${wall.id}-span-${index}`, span))

    for (const opening of openingsByWall.get(wall.id) ?? []) {
      if (opening.kind !== 'window') continue
      const center = (opening.x - wall.x) * Math.cos(wall.rotationY) - (opening.z - wall.z) * Math.sin(wall.rotationY)
      const start = Math.max(-wall.length / 2, center - opening.width / 2)
      const end = Math.min(wall.length / 2, center + opening.width / 2)
      if (end <= start) continue
      const span = { start, end }
      const sillHeight = Math.min(WINDOW_SILL_HEIGHT, wall.height)
      const lintelBottom = Math.min(sillHeight + WINDOW_OPENING_HEIGHT, wall.height)
      if (sillHeight > 0) {
        const lower = fullHeightPiece(`${opening.id}-sill`, span)
        lower.y = sillHeight / 2
        lower.height = sillHeight
        pieces.push(lower)
      }
      if (lintelBottom < wall.height) {
        const upper = fullHeightPiece(`${opening.id}-lintel`, span)
        upper.y = lintelBottom + (wall.height - lintelBottom) / 2
        upper.height = wall.height - lintelBottom
        pieces.push(upper)
      }
    }
    return pieces
  })
}
