import type { WallSegment } from './floorplanEditor'

export type Bounds = {
  x1: number
  y1: number
  x2: number
  y2: number
}

export type Room = {
  name: string
  type: string
  approximate_bounds: Bounds
  area_ratio?: number
}

export type ParsedOpening = {
  type?: string
  x?: number
  y?: number
  from?: string
  to?: string
}

export type ParseResult = {
  rooms: Room[]
  walls: WallSegment[]
  doors: ParsedOpening[]
  windows: ParsedOpening[]
  scale: { unit: string; pixel_to_unit?: number }
  metadata: { source: string; confidence?: number; image_width?: number; image_height?: number }
}

export type ParseResponse = {
  filename: string
  contentType: string
  size: number
  result: ParseResult
}

export type Viewport = {
  minX: number
  minY: number
  width: number
  height: number
}

export type CanvasSize = {
  width: number
  height: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value)
}

function isBounds(value: unknown): value is Bounds {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x1) &&
    isFiniteNumber(value.y1) &&
    isFiniteNumber(value.x2) &&
    isFiniteNumber(value.y2)
  )
}

function isRoom(value: unknown): value is Room {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    isBounds(value.approximate_bounds) &&
    isOptionalFiniteNumber(value.area_ratio)
  )
}

function isWall(value: unknown): value is WallSegment {
  return isBounds(value)
}

function isOpening(value: unknown): value is ParsedOpening {
  return (
    isRecord(value) &&
    (value.type === undefined || typeof value.type === 'string') &&
    (value.from === undefined || typeof value.from === 'string') &&
    (value.to === undefined || typeof value.to === 'string') &&
    isOptionalFiniteNumber(value.x) &&
    isOptionalFiniteNumber(value.y)
  )
}

function isParseResult(value: unknown): value is ParseResult {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.rooms) || !value.rooms.every(isRoom)) return false
  if (!Array.isArray(value.walls) || !value.walls.every(isWall)) return false
  if (!Array.isArray(value.doors) || !value.doors.every(isOpening)) return false
  if (!Array.isArray(value.windows) || !value.windows.every(isOpening)) return false
  if (!isRecord(value.scale) || typeof value.scale.unit !== 'string' || !isOptionalFiniteNumber(value.scale.pixel_to_unit)) {
    return false
  }
  return (
    isRecord(value.metadata) &&
    typeof value.metadata.source === 'string' &&
    isOptionalFiniteNumber(value.metadata.confidence) &&
    isOptionalFiniteNumber(value.metadata.image_width) &&
    isOptionalFiniteNumber(value.metadata.image_height)
  )
}

export function isParseResponse(value: unknown): value is ParseResponse {
  return (
    isRecord(value) &&
    typeof value.filename === 'string' &&
    typeof value.contentType === 'string' &&
    isFiniteNumber(value.size) &&
    value.size >= 0 &&
    isParseResult(value.result)
  )
}

export function canvasScale(size: CanvasSize, viewport: Viewport): number | null {
  if (
    !isFiniteNumber(size.width) ||
    !isFiniteNumber(size.height) ||
    !isFiniteNumber(viewport.width) ||
    !isFiniteNumber(viewport.height) ||
    size.width <= 0 ||
    size.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null
  }

  const scale = Math.min(size.width / viewport.width, size.height / viewport.height)
  return Number.isFinite(scale) && scale > 0 ? scale : null
}

export function canvasUnitsForCssPixels(cssPixels: number, scale: number | null): number {
  if (!Number.isFinite(cssPixels) || cssPixels <= 0 || !scale || !Number.isFinite(scale) || scale <= 0) {
    return cssPixels
  }
  return cssPixels / scale
}

export function openingLabel(opening: ParsedOpening): string | null {
  const type = opening.type?.trim()
  const from = opening.from?.trim()
  const to = opening.to?.trim()
  const connection = from && to ? `${from} → ${to}` : from || to

  if (type && connection) return `${type} · ${connection}`
  return type || connection || null
}
