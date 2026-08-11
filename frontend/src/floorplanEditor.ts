import { MIN_CANONICAL_WALL_LENGTH, validateOpenings, type ParsedOpening } from './floorplanUi'

export type Endpoint = 'start' | 'end'

export interface WallSegment {
  /** Durable wall identity; legacy parse previews may omit it until normalized. */
  id?: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Point { x: number; y: number }
export interface EndpointRef { wallIndex: number; endpoint: Endpoint }

type EditorSnapshot = { walls: WallSegment[]; openings: ParsedOpening[] }

export interface WallEditorState {
  walls: WallSegment[]
  openings: ParsedOpening[]
  undoStack: EditorSnapshot[]
  redoStack: EditorSnapshot[]
  endpointTolerance: number
  sharedEndpoints: ReadonlyMap<string, ReadonlyArray<EndpointRef>>
}

export interface EndpointMoveResult { walls: WallSegment[]; changed: boolean }
export interface WallCoordinateEditResult extends EndpointMoveResult { error: string | null }
export interface OpeningEditResult { openings: ParsedOpening[]; changed: boolean; error: string | null }

function isFiniteNumber(value: number): value is number { return Number.isFinite(value) }
function isFinitePoint(point: Point): boolean { return isFiniteNumber(point.x) && isFiniteNumber(point.y) }
function isFiniteSegment(segment: WallSegment): boolean { return [segment.x1, segment.y1, segment.x2, segment.y2].every(isFiniteNumber) }
function cloneSegments(segments: readonly WallSegment[]): WallSegment[] { return segments.map((segment) => ({ ...segment })) }
function cloneOpenings(openings: readonly ParsedOpening[]): ParsedOpening[] { return openings.map((opening) => ({ ...opening })) }
function cloneSnapshot(state: Pick<WallEditorState, 'walls' | 'openings'>): EditorSnapshot { return { walls: cloneSegments(state.walls), openings: cloneOpenings(state.openings) } }
function areSegmentsEqual(left: readonly WallSegment[], right: readonly WallSegment[]): boolean { return left.length === right.length && left.every((v, i) => v.id === right[i].id && v.x1 === right[i].x1 && v.y1 === right[i].y1 && v.x2 === right[i].x2 && v.y2 === right[i].y2) }
function areOpeningsEqual(left: readonly ParsedOpening[], right: readonly ParsedOpening[]): boolean { return left.length === right.length && left.every((v, i) => JSON.stringify(v) === JSON.stringify(right[i])) }
function endpointPoint(segment: WallSegment, endpoint: Endpoint): Point { return endpoint === 'start' ? { x: segment.x1, y: segment.y1 } : { x: segment.x2, y: segment.y2 } }
function applyEndpointPoint(segment: WallSegment, endpoint: Endpoint, point: Point): WallSegment { return endpoint === 'start' ? { ...segment, x1: point.x, y1: point.y } : { ...segment, x2: point.x, y2: point.y } }
function endpointKey(point: Point): string { return `${point.x},${point.y}` }
function collectSharedEndpoints(walls: readonly WallSegment[]): ReadonlyMap<string, ReadonlyArray<EndpointRef>> { const groups = new Map<string, EndpointRef[]>(); walls.forEach((wall, wallIndex) => { (['start', 'end'] as const).forEach((endpoint) => { const key = endpointKey(endpointPoint(wall, endpoint)); const group = groups.get(key) ?? []; group.push({ wallIndex, endpoint }); groups.set(key, group) }) }); return groups }
function isValidEndpointRef(state: WallEditorState, endpointRef: EndpointRef): boolean { return Number.isInteger(endpointRef.wallIndex) && endpointRef.wallIndex >= 0 && endpointRef.wallIndex < state.walls.length && (endpointRef.endpoint === 'start' || endpointRef.endpoint === 'end') && isFiniteSegment(state.walls[endpointRef.wallIndex]) }
function withDocument(state: WallEditorState, walls: readonly WallSegment[], openings: readonly ParsedOpening[] = state.openings): WallEditorState { const clonedWalls = cloneSegments(walls); return { ...state, walls: clonedWalls, openings: cloneOpenings(openings), sharedEndpoints: collectSharedEndpoints(clonedWalls) } }

export function createWallEditorState(segments: readonly WallSegment[], openingsOrTolerance: readonly ParsedOpening[] | number = [], endpointTolerance = 6): WallEditorState {
  // Keep the prior two-argument API for callers that only edit walls.
  const openings = typeof openingsOrTolerance === 'number' ? [] : openingsOrTolerance
  const tolerance = typeof openingsOrTolerance === 'number' ? openingsOrTolerance : endpointTolerance
  const walls = segments.filter(isFiniteSegment)
  return { walls: cloneSegments(walls), openings: cloneOpenings(openings), undoStack: [], redoStack: [], endpointTolerance: tolerance, sharedEndpoints: collectSharedEndpoints(walls) }
}

export function getWallForEndpoint(state: WallEditorState, endpointRef: EndpointRef): Point | null { return isValidEndpointRef(state, endpointRef) ? endpointPoint(state.walls[endpointRef.wallIndex], endpointRef.endpoint) : null }
export function moveEndpoint(state: WallEditorState, endpointRef: EndpointRef, cursor: Point): EndpointMoveResult { const anchor = getWallForEndpoint(state, endpointRef); if (!anchor || !isFinitePoint(cursor)) return { walls: cloneSegments(state.walls), changed: false }; const targets = state.sharedEndpoints.get(endpointKey(anchor)) ?? [endpointRef]; const moved = cloneSegments(state.walls); targets.forEach((target) => { if (isValidEndpointRef(state, target)) moved[target.wallIndex] = applyEndpointPoint(moved[target.wallIndex], target.endpoint, cursor) }); return { walls: moved, changed: !areSegmentsEqual(moved, state.walls) } }

export function editWallCoordinates(
  state: WallEditorState,
  wallID: string,
  coordinates: Pick<WallSegment, 'x1' | 'y1' | 'x2' | 'y2'>,
  image: { width: number; height: number },
): WallCoordinateEditResult {
  const wallIndex = state.walls.findIndex((wall) => wall.id === wallID)
  if (wallIndex < 0) return { walls: cloneSegments(state.walls), changed: false, error: 'wall is missing' }
  if (![coordinates.x1, coordinates.y1, coordinates.x2, coordinates.y2, image.width, image.height].every(Number.isFinite)) return { walls: cloneSegments(state.walls), changed: false, error: 'wall coordinates must be finite' }
  if (image.width <= 0 || image.height <= 0 || coordinates.x1 < 0 || coordinates.x1 > image.width || coordinates.x2 < 0 || coordinates.x2 > image.width || coordinates.y1 < 0 || coordinates.y1 > image.height || coordinates.y2 < 0 || coordinates.y2 > image.height) return { walls: cloneSegments(state.walls), changed: false, error: 'wall coordinates must remain inside the source image' }
  if (!(Math.hypot(coordinates.x2 - coordinates.x1, coordinates.y2 - coordinates.y1) > MIN_CANONICAL_WALL_LENGTH)) return { walls: cloneSegments(state.walls), changed: false, error: 'wall length must be strictly greater than zero' }
  const wall = state.walls[wallIndex]
  const moved = cloneSegments(state.walls)
  const applyShared = (endpoint: Endpoint, point: Point) => {
    const targets = state.sharedEndpoints.get(endpointKey(endpointPoint(wall, endpoint))) ?? [{ wallIndex, endpoint }]
    targets.forEach((target) => {
      if (isValidEndpointRef(state, target)) moved[target.wallIndex] = applyEndpointPoint(moved[target.wallIndex], target.endpoint, point)
    })
  }
  applyShared('start', { x: coordinates.x1, y: coordinates.y1 })
  applyShared('end', { x: coordinates.x2, y: coordinates.y2 })
  if (moved.some((item) => !isFiniteSegment(item) || !(Math.hypot(item.x2 - item.x1, item.y2 - item.y1) > MIN_CANONICAL_WALL_LENGTH))) return { walls: cloneSegments(state.walls), changed: false, error: 'wall length must be strictly greater than zero' }
  if (moved.some((item) => item.x1 < 0 || item.x1 > image.width || item.x2 < 0 || item.x2 > image.width || item.y1 < 0 || item.y1 > image.height || item.y2 < 0 || item.y2 > image.height)) return { walls: cloneSegments(state.walls), changed: false, error: 'wall coordinates must remain inside the source image' }
  const openingError = validateOpenings(moved, state.openings)
  if (openingError) return { walls: cloneSegments(state.walls), changed: false, error: openingError }
  return { walls: moved, changed: !areSegmentsEqual(moved, state.walls), error: null }
}

/** Commits one atomic wall/opening document snapshot. */
export function pushWallSnapshot(state: WallEditorState, nextWalls: readonly WallSegment[], nextOpenings: readonly ParsedOpening[] = state.openings): WallEditorState {
  if (areSegmentsEqual(state.walls, nextWalls) && areOpeningsEqual(state.openings, nextOpenings)) return state
  return { ...withDocument(state, nextWalls, nextOpenings), undoStack: [...state.undoStack, cloneSnapshot(state)], redoStack: [] }
}

function editOpenings(state: WallEditorState, next: readonly ParsedOpening[]): OpeningEditResult {
  const error = validateOpenings(state.walls, next)
  return error ? { openings: cloneOpenings(state.openings), changed: false, error } : { openings: cloneOpenings(next), changed: !areOpeningsEqual(state.openings, next), error: null }
}

export function addOpening(state: WallEditorState, opening: ParsedOpening): OpeningEditResult { return editOpenings(state, [...state.openings, opening]) }
export function updateOpening(state: WallEditorState, openingID: string, patch: Partial<ParsedOpening>): OpeningEditResult { const found = state.openings.some((opening) => opening.id === openingID); return found ? editOpenings(state, state.openings.map((opening) => opening.id === openingID ? { ...opening, ...patch } : opening)) : { openings: cloneOpenings(state.openings), changed: false, error: 'opening is missing' } }
export function removeOpening(state: WallEditorState, openingID: string): OpeningEditResult { const next = state.openings.filter((opening) => opening.id !== openingID); return next.length === state.openings.length ? { openings: cloneOpenings(state.openings), changed: false, error: 'opening is missing' } : { openings: next, changed: true, error: null } }
export function canUndo(state: WallEditorState | null): boolean { return !!state && state.undoStack.length > 0 }
export function canRedo(state: WallEditorState | null): boolean { return !!state && state.redoStack.length > 0 }
export function undo(state: WallEditorState): WallEditorState { if (!state.undoStack.length) return state; const previous = state.undoStack[state.undoStack.length - 1]; return { ...withDocument(state, previous.walls, previous.openings), undoStack: state.undoStack.slice(0, -1), redoStack: [cloneSnapshot(state), ...state.redoStack] } }
export function redo(state: WallEditorState): WallEditorState { if (!state.redoStack.length) return state; const [next, ...remaining] = state.redoStack; return { ...withDocument(state, next.walls, next.openings), undoStack: [...state.undoStack, cloneSnapshot(state)], redoStack: remaining } }
