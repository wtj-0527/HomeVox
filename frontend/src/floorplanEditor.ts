export type Endpoint = 'start' | 'end'

export interface WallSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Point {
  x: number
  y: number
}

export interface EndpointRef {
  wallIndex: number
  endpoint: Endpoint
}

export interface WallEditorState {
  walls: WallSegment[]
  undoStack: WallSegment[][]
  redoStack: WallSegment[][]
  endpointTolerance: number
}

export interface EndpointMoveResult {
  walls: WallSegment[]
  changed: boolean
}

function isFiniteNumber(value: number): value is number {
  return Number.isFinite(value)
}

function isFinitePoint(point: Point): boolean {
  return isFiniteNumber(point.x) && isFiniteNumber(point.y)
}

function isFiniteSegment(segment: WallSegment): boolean {
  return (
    isFiniteNumber(segment.x1) &&
    isFiniteNumber(segment.y1) &&
    isFiniteNumber(segment.x2) &&
    isFiniteNumber(segment.y2)
  )
}

function cloneSegments(segments: readonly WallSegment[]): WallSegment[] {
  return segments.map((segment) => ({ ...segment }))
}

function areSegmentsEqual(left: readonly WallSegment[], right: readonly WallSegment[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let i = 0; i < left.length; i += 1) {
    if (
      left[i].x1 !== right[i].x1 ||
      left[i].y1 !== right[i].y1 ||
      left[i].x2 !== right[i].x2 ||
      left[i].y2 !== right[i].y2
    ) {
      return false
    }
  }
  return true
}

function endpointPoint(segment: WallSegment, endpoint: Endpoint): Point {
  return endpoint === 'start'
    ? { x: segment.x1, y: segment.y1 }
    : { x: segment.x2, y: segment.y2 }
}

function applyEndpointPoint(segment: WallSegment, endpoint: Endpoint, point: Point): WallSegment {
  return endpoint === 'start'
    ? { ...segment, x1: point.x, y1: point.y }
    : { ...segment, x2: point.x, y2: point.y }
}

export function createWallEditorState(
  segments: readonly WallSegment[],
  endpointTolerance = 6,
): WallEditorState {
  const walls = segments.filter(isFiniteSegment)
  return {
    walls: cloneSegments(walls),
    undoStack: [],
    redoStack: [],
    endpointTolerance,
  }
}

export function getWallForEndpoint(
  state: WallEditorState,
  endpointRef: EndpointRef,
): Point {
  return endpointPoint(state.walls[endpointRef.wallIndex], endpointRef.endpoint)
}

export function moveEndpoint(
  state: WallEditorState,
  endpointRef: EndpointRef,
  cursor: Point,
): EndpointMoveResult {
  const anchor = getWallForEndpoint(state, endpointRef)
  if (!isFiniteSegment(state.walls[endpointRef.wallIndex]) || !isFinitePoint(cursor)) {
    return {
      walls: cloneSegments(state.walls),
      changed: false,
    }
  }

  if (!isFinitePoint(anchor)) {
    return {
      walls: cloneSegments(state.walls),
      changed: false,
    }
  }

  const toleranceSq = state.endpointTolerance * state.endpointTolerance
  const targetEndpoints: Array<{ wallIndex: number; endpoint: Endpoint }> = []

  for (let wallIndex = 0; wallIndex < state.walls.length; wallIndex += 1) {
    const wall = state.walls[wallIndex]
    if (!isFiniteSegment(wall)) {
      continue
    }

    const start = { x: wall.x1, y: wall.y1 }
    if ((start.x - anchor.x) ** 2 + (start.y - anchor.y) ** 2 <= toleranceSq) {
      targetEndpoints.push({ wallIndex, endpoint: 'start' })
    }

    const end = { x: wall.x2, y: wall.y2 }
    if ((end.x - anchor.x) ** 2 + (end.y - anchor.y) ** 2 <= toleranceSq) {
      targetEndpoints.push({ wallIndex, endpoint: 'end' })
    }
  }

  if (targetEndpoints.length === 0) {
    return {
      walls: cloneSegments(state.walls),
      changed: false,
    }
  }

  const moved = cloneSegments(state.walls)
  for (const target of targetEndpoints) {
    moved[target.wallIndex] = applyEndpointPoint(moved[target.wallIndex], target.endpoint, cursor)
  }

  return {
    walls: moved,
    changed: !areSegmentsEqual(moved, state.walls),
  }
}

export function pushWallSnapshot(state: WallEditorState, nextWalls: readonly WallSegment[]): WallEditorState {
  if (areSegmentsEqual(state.walls, nextWalls)) {
    return state
  }

  return {
    ...state,
    walls: cloneSegments(nextWalls),
    undoStack: [...state.undoStack, cloneSegments(state.walls)],
    redoStack: [],
  }
}

export function canUndo(state: WallEditorState | null): boolean {
  return !!state && state.undoStack.length > 0
}

export function canRedo(state: WallEditorState | null): boolean {
  return !!state && state.redoStack.length > 0
}

export function undo(state: WallEditorState): WallEditorState {
  if (state.undoStack.length === 0) {
    return state
  }
  const newUndo = state.undoStack.slice(0, -1)
  const previous = state.undoStack[state.undoStack.length - 1]
  return {
    ...state,
    walls: cloneSegments(previous),
    undoStack: newUndo,
    redoStack: [cloneSegments(state.walls), ...state.redoStack],
  }
}

export function redo(state: WallEditorState): WallEditorState {
  if (state.redoStack.length === 0) {
    return state
  }
  const [next, ...remaining] = state.redoStack
  return {
    ...state,
    walls: cloneSegments(next),
    undoStack: [...state.undoStack, cloneSegments(state.walls)],
    redoStack: remaining,
  }
}
