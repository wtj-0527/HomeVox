import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Canvas, type RootState } from '@react-three/fiber'
import { Grid, Html, OrbitControls } from '@react-three/drei'
import type { BufferGeometry } from 'three'
import {
  type EndpointRef,
  type WallSegment,
  canRedo,
  canUndo,
  createWallEditorState,
  addOpening,
  moveEndpoint,
  pushWallSnapshot,
  removeOpening,
  updateOpening,
  redo as redoEditor,
  undo as undoEditor,
  type WallEditorState,
} from './floorplanEditor'
import {
  canvasScale,
  canvasUnitsForCssPixels,
  isParseResponse,
  openingLabel,
  openingPoint,
  validateOpenings,
  MIN_OPENING_WIDTH,
  type ParsedOpening,
  type ParseResponse,
  type ParseResult,
  type Viewport,
} from './floorplanUi'
import { buildWallShellModel, type WallShellModel } from './wallShell'
import { buildWallVoxelModel, type WallVoxelModel } from './wallVoxel'
import { runMarchingCubes, type MarchingCubesMetrics, type WasmBindings, type WasmFallbackReason } from './wasmMarchingCubes'
import { buildWasmWallGeometry, disposeWasmWallGeometry } from './wasmGeometry'
import {
  buildExportFileName,
  downloadBlobAsPng,
  exportSvgElementToPng,
  exportWebGLCanvasToPng,
  validateCanvasSize,
} from './export'
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
  type ProjectDetail,
  type ProjectSummary,
} from './projects'
import { PRODUCT_STEPS, canOpenStep, type ProductStep } from './productFlow'
import './App.css'

const API_PARSE_URL = '/api/floorplans/parse'
const EMPTY_WALLS: WallSegment[] = []
const E2E_WALL_FIXTURE: ParseResponse = {
  filename: 'e2e-wall-fixture.png',
  contentType: 'image/png',
  size: 80,
  result: {
    rooms: [],
    walls: [
      { id: 'wall-1', x1: 80, y1: 80, x2: 520, y2: 80 },
      { id: 'wall-2', x1: 520, y1: 80, x2: 520, y2: 360 },
      { id: 'wall-3', x1: 520, y1: 360, x2: 80, y2: 360 },
      { id: 'wall-4', x1: 80, y1: 360, x2: 80, y2: 80 },
    ],
    doors: [{ id: 'door-1', kind: 'door', wallId: 'wall-1', position: 0.5, width: 72, source: 'fixture', confirmed: false }],
    windows: [{ id: 'window-1', kind: 'window', wallId: 'wall-2', position: 0.5, width: 64, source: 'fixture', confirmed: false }],
    scale: { unit: 'px' },
    metadata: { source: 'production-e2e-fixture', image_width: 600, image_height: 440 },
  },
}

const E2E_INVALID_OPENING_FIXTURE: ParseResponse = {
  ...E2E_WALL_FIXTURE,
  result: {
    ...E2E_WALL_FIXTURE.result,
    doors: [{ id: 'door-invalid', kind: 'door', wallId: 'missing-wall', position: 0.5, width: 72, source: 'fixture', confirmed: false }],
    windows: [],
  },
}

const E2E_DUPLICATE_WALL_ID_FIXTURE: ParseResponse = {
  ...E2E_WALL_FIXTURE,
  result: {
    ...E2E_WALL_FIXTURE.result,
    walls: [
      { id: 'wall-duplicate', x1: 80, y1: 80, x2: 520, y2: 80 },
      { id: 'wall-duplicate', x1: 520, y1: 80, x2: 520, y2: 360 },
    ],
    doors: [{ id: 'door-duplicate', kind: 'door', wallId: 'wall-duplicate', position: 0.5, width: 72, source: 'fixture', confirmed: false }],
    windows: [],
  },
}

type ParseState = 'idle' | 'uploading' | 'ready' | 'error'

type ScenePoint = {
  x: number
  y: number
}

declare global {
  interface Window {
    __homevoxE2E?: {
      generation: number
      wasmCalls: number
      metrics: MarchingCubesMetrics | null
      geometry: { positionCount: number; normalCount: number; finite: boolean; fingerprint: number }
      currentProjectId: string | null
      selectedOpeningId: string | null
      walls: Array<{ id: string | null; x1: number; y1: number; x2: number; y2: number }>
      openings: Array<{ id: string | null; wallId: string | null; position: number | null; width: number | null }>
    }
  }
}

function e2EFixture(): ParseResponse | null {
  if (typeof window === 'undefined') return null
  switch (new URLSearchParams(window.location.search).get('e2e')) {
    case 'wall-fixture': return E2E_WALL_FIXTURE
    case 'invalid-opening': return E2E_INVALID_OPENING_FIXTURE
    case 'duplicate-wall-id': return E2E_DUPLICATE_WALL_ID_FIXTURE
    default: return null
  }
}

function isE2EFixtureEnabled(): boolean {
  return e2EFixture() !== null
}

function isE2EInstrumentationEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('e2e')
}

function e2EProjectID(): string | null {
  if (typeof window === 'undefined') return null
  const value = new URLSearchParams(window.location.search).get('project')
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null
}

function e2EWasmFailureEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('wasm') === 'load-failure'
}

const failingE2EWasmLoader = async (): Promise<WasmBindings> => {
  throw new Error('E2E fixture rejected WASM loader')
}


function isFinitePositiveInteger(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteCoordinate(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function safeNumber(value: number | undefined | null, fallback: number): number {
  return isFiniteCoordinate(value) ? value : fallback
}

function finiteNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function collectViewportFromParse(result: ParseResult | null): Viewport | null {
  if (!result) return null

  const coords: number[] = []
  for (const room of result.rooms) {
    const b = room.approximate_bounds
    if (finiteNumber(b.x1) && finiteNumber(b.y1) && finiteNumber(b.x2) && finiteNumber(b.y2)) {
      coords.push(b.x1, b.y1, b.x2, b.y2)
    }
  }

  for (const wall of result.walls) {
    if (finiteNumber(wall.x1) && finiteNumber(wall.y1) && finiteNumber(wall.x2) && finiteNumber(wall.y2)) {
      coords.push(wall.x1, wall.y1, wall.x2, wall.y2)
    }
  }

  for (const opening of [...result.doors, ...result.windows]) {
    if (finiteNumber(opening.x) && finiteNumber(opening.y)) {
      coords.push(opening.x, opening.y)
    }
  }

  if (coords.length < 2) {
    return null
  }

  const xs = coords.filter((_, index) => index % 2 === 0)
  const ys = coords.filter((_, index) => index % 2 === 1)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const rawWidth = maxX - minX
  const rawHeight = maxY - minY

  if (rawWidth <= 0 || rawHeight <= 0) {
    return null
  }

  const padding = Math.max(rawWidth, rawHeight) * 0.1

  return {
    minX: minX - padding,
    minY: minY - padding,
    width: rawWidth + padding * 2,
    height: rawHeight + padding * 2,
  }
}

function chooseViewport(result: ParseResult | null, fallbackImageSize: { width: number; height: number } | null): Viewport {
  const imageWidth = safeNumber(result?.metadata.image_width, Number.NaN)
  const imageHeight = safeNumber(result?.metadata.image_height, Number.NaN)

  if (isFinitePositiveInteger(imageWidth) && isFinitePositiveInteger(imageHeight)) {
    return {
      minX: 0,
      minY: 0,
      width: imageWidth,
      height: imageHeight,
    }
  }

  if (fallbackImageSize) {
    if (isFinitePositiveInteger(fallbackImageSize.width) && isFinitePositiveInteger(fallbackImageSize.height)) {
      return {
        minX: 0,
        minY: 0,
        width: fallbackImageSize.width,
        height: fallbackImageSize.height,
      }
    }
  }

  const inferred = collectViewportFromParse(result)
  if (inferred) {
    return inferred
  }

  return {
    minX: 0,
    minY: 0,
    width: 1024,
    height: 768,
  }
}

type FloorplanSceneProps = {
  model: WallShellModel
  wasmGeometry: BufferGeometry | null
  wasmActive: boolean
  selectedWallID: string | null
  selectedOpeningID: string | null
  onSelectWall: (wallID: string) => void
  onSelectOpening: (openingID: string) => void
}

function Scene({ model, wasmGeometry, wasmActive, selectedWallID, selectedOpeningID, onSelectWall, onSelectOpening }: FloorplanSceneProps) {

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 15, 10]} intensity={0.95} castShadow />

      {model.floor && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[model.floor.x, 0, model.floor.z]}
          receiveShadow
          data-testid="wall-shell-floor"
        >
          <planeGeometry args={[model.floor.width, model.floor.depth]} />
          <meshStandardMaterial color="#243047" roughness={0.82} />
        </mesh>
      )}

      <Grid
        args={[18, 18]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#334155"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#64748b"
        fadeDistance={30}
        infiniteGrid
      />

      {wasmActive && wasmGeometry && (
        <mesh geometry={wasmGeometry} castShadow receiveShadow data-testid="wasm-wall-mesh">
          <meshStandardMaterial color="#e2e8f0" roughness={0.72} />
        </mesh>
      )}

      {model.walls.map((wall) => (
        <group key={`wall-shell-${wall.id}`}>
          <mesh
            position={[wall.x, wall.height / 2, wall.z]}
            rotation={[0, wall.rotationY, 0]}
            castShadow
            receiveShadow
            userData={{ wallId: wall.id }}
            onPointerDown={(event) => { event.stopPropagation(); onSelectWall(wall.id) }}
            onClick={(event) => { event.stopPropagation(); onSelectWall(wall.id) }}
          >
            <boxGeometry args={[wall.length, wall.height, wall.thickness]} />
            <meshStandardMaterial
              color={selectedWallID === wall.id ? '#facc15' : '#e2e8f0'}
              roughness={0.72}
              transparent={wasmActive && selectedWallID !== wall.id}
              opacity={wasmActive && selectedWallID !== wall.id ? 0.08 : 1}
            />
          </mesh>
          <Html position={[wall.x, wall.height + 0.32, wall.z]} center>
            <button
              type="button"
              data-testid={`three-wall-${wall.id}`}
              aria-label={`3D 选择墙体 ${wall.id}`}
              aria-pressed={selectedWallID === wall.id}
              data-selected={selectedWallID === wall.id ? 'true' : 'false'}
              className="h-4 w-4 rounded border border-white bg-slate-950/45 p-0 shadow"
              onClick={() => onSelectWall(wall.id)}
            />
          </Html>
        </group>
      ))}

      {model.openings.map((opening) => {
        const isDoor = opening.kind === 'door'
        const markerHeight = isDoor ? 3.2 : 3.7
        const markerRadius = isDoor ? 0.28 : 0.24
        return (
          <group key={opening.id}>
            <mesh
              data-testid={`three-opening-${opening.id}`}
              position={[opening.x, markerHeight, opening.z]}
              renderOrder={10}
              userData={{ openingId: opening.id, openingKind: opening.kind, label: opening.label }}
              onPointerDown={(event) => { event.stopPropagation(); onSelectOpening(opening.id) }}
              onClick={(event) => { event.stopPropagation(); onSelectOpening(opening.id) }}
            >
              <sphereGeometry args={[markerRadius, 20, 14]} />
              <meshBasicMaterial
                color={selectedOpeningID === opening.id ? '#facc15' : isDoor ? '#f97316' : '#38bdf8'}
                depthTest={false}
                toneMapped={false}
              />
              <mesh>
                <sphereGeometry args={[0.65, 16, 12]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </mesh>
            <Html position={[opening.x, markerHeight, opening.z]} center>
              <button
                type="button"
                data-testid={`three-opening-button-${opening.id}`}
                aria-label={`3D 选择${isDoor ? '门' : '窗'} ${opening.id}`}
                aria-pressed={selectedOpeningID === opening.id}
                className="h-5 w-5 rounded-full border-2 border-white bg-slate-950/30 p-0 shadow-lg"
                onClick={() => onSelectOpening(opening.id)}
              />
            </Html>
          </group>
        )
      })}
    </>
  )
}

function distanceSq(a: ScenePoint, b: ScenePoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

function pickEndpoint(
  walls: readonly WallSegment[],
  cursor: ScenePoint,
  tolerance: number,
): EndpointRef | null {
  let nearest: EndpointRef | null = null
  let minDistance = Number.POSITIVE_INFINITY
  const pickToleranceSq = tolerance * tolerance

  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i]
    const start = { x: wall.x1, y: wall.y1 }
    const startDistanceSq = distanceSq(start, cursor)
    if (startDistanceSq <= Math.min(minDistance, pickToleranceSq)) {
      nearest = { wallIndex: i, endpoint: 'start' }
      minDistance = startDistanceSq
    }

    const end = { x: wall.x2, y: wall.y2 }
    const endDistanceSq = distanceSq(end, cursor)
    if (endDistanceSq <= Math.min(minDistance, pickToleranceSq)) {
      nearest = { wallIndex: i, endpoint: 'end' }
      minDistance = endDistanceSq
    }
  }

  return nearest
}

function toCanvasPoint(
  event: { clientX: number; clientY: number },
  svg: SVGSVGElement,
  viewport: Viewport,
): ScenePoint {
  const rect = svg.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: Number.NaN, y: Number.NaN }
  }

  // Match the outer SVG's preserveAspectRatio="xMinYMin meet" transform exactly.
  const scale = Math.min(rect.width / viewport.width, rect.height / viewport.height)
  const renderedWidth = viewport.width * scale
  const renderedHeight = viewport.height * scale
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  if (x < 0 || y < 0 || x > renderedWidth || y > renderedHeight) {
    return { x: Number.NaN, y: Number.NaN }
  }

  return {
    x: viewport.minX + x / scale,
    y: viewport.minY + y / scale,
  }
}

function hasFiniteCoordinate(point: ScenePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function hasWebGLSupport(): boolean {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  return Boolean(
    canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl'),
  )
}

export default function App() {
  const [activeStep, setActiveStep] = useState<ProductStep>(1)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewURL, setPreviewURL] = useState<string>('')
  const [parseResponse, setParseResponse] = useState<ParseResponse | null>(null)
  const [status, setStatus] = useState<ParseState>('idle')
  const [error, setError] = useState<string>('')
  const [exportError, setExportError] = useState<string>('')
  const [exportingScope, setExportingScope] = useState<null | '2d' | '3d'>(null)
  const [wallEditor, setWallEditor] = useState<WallEditorState | null>(null)
  const [hoveredEndpoint, setHoveredEndpoint] = useState<EndpointRef | null>(null)
  const [draggedEndpoint, setDraggedEndpoint] = useState<EndpointRef | null>(null)
  const [dragPreviewWalls, setDragPreviewWalls] = useState<WallSegment[] | null>(null)
  const [selectedOpeningID, setSelectedOpeningID] = useState<string | null>(null)
  const [draggedOpeningID, setDraggedOpeningID] = useState<string | null>(null)
  const [dragPreviewOpenings, setDragPreviewOpenings] = useState<ParsedOpening[] | null>(null)
  const [openingError, setOpeningError] = useState('')
  const [selectedWallID, setSelectedWallID] = useState<string | null>(null)
  const [showSourceImage, setShowSourceImage] = useState(true)
  const [imageDimFallback, setImageDimFallback] = useState<{ width: number; height: number } | null>(null)
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0 })
  const [threeRenderer, setThreeRenderer] = useState<RootState | null>(null)
  const [projectName, setProjectName] = useState('')
  const [currentProject, setCurrentProject] = useState<ProjectDetail | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectMessage, setProjectMessage] = useState('')
  const [projectBusy, setProjectBusy] = useState<null | 'list' | 'save' | 'load'>(null)
  const [wasmGeometry, setWasmGeometry] = useState<BufferGeometry | null>(null)
  const [wasmState, setWasmState] = useState<'idle' | 'loading' | 'active' | 'fallback'>('idle')
  const [wasmMetrics, setWasmMetrics] = useState<MarchingCubesMetrics | null>(null)
  const [, setWasmFallback] = useState<WasmFallbackReason | null>(null)
  const webGLAvailable = useMemo(hasWebGLSupport, [])
  const exportSequenceRef = useRef(0)

  const editorRef = useRef<SVGSVGElement | null>(null)
  const svgUrlRef = useRef('')
  const parseRequestRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const requestSequenceRef = useRef(0)
  const projectRequestRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const projectSequenceRef = useRef(0)
  const wasmGenerationRef = useRef(0)
  const wasmGeometryRef = useRef<BufferGeometry | null>(null)
  const wasmCallsRef = useRef(0)

  const result = parseResponse?.result ?? null
  const walls = dragPreviewWalls ?? wallEditor?.walls ?? result?.walls ?? EMPTY_WALLS
  const openings = useMemo(() => dragPreviewOpenings ?? wallEditor?.openings ?? (result ? [...result.doors, ...result.windows] : []), [dragPreviewOpenings, result, wallEditor])
  const [doors, windows] = useMemo(() => [openings.filter((opening) => opening.kind === 'door'), openings.filter((opening) => opening.kind === 'window')], [openings])
  const selectedOpening = openings.find((opening) => opening.id === selectedOpeningID) ?? null
  const selectedWall = walls.find((wall) => wall.id === selectedWallID) ?? null

  const durableDocument = useMemo<ParseResponse | null>(() => (
    parseResponse ? { ...parseResponse, result: { ...parseResponse.result, walls, doors, windows } } : null
  ), [parseResponse, walls, doors, windows])
  const geometryValidationError = useMemo(
    () => validateOpenings(walls, openings),
    [walls, openings],
  )
  const hasCanonicalGeometry = Boolean(durableDocument) && !geometryValidationError
  const hasRealThreeDGeometry = wasmState === 'active' && wasmGeometry !== null
  const canOpenLinkedWorkspace = hasCanonicalGeometry && webGLAvailable && hasRealThreeDGeometry
  const wallShellModel = useMemo(
    () => buildWallShellModel(walls, doors, windows),
    [walls, doors, windows],
  )
  const wallVoxelModel = useMemo(() => buildWallVoxelModel(walls, doors, windows), [walls, doors, windows])

  const viewport = chooseViewport(result, imageDimFallback)
  const editorScale = canvasScale(editorSize, viewport)
  const hitRadius = canvasUnitsForCssPixels(16, editorScale)
  const handleRadius = canvasUnitsForCssPixels(5, editorScale)
  const activeHandleRadius = canvasUnitsForCssPixels(7, editorScale)
  const wallHitStroke = canvasUnitsForCssPixels(16, editorScale)
  const wallStroke = canvasUnitsForCssPixels(2, editorScale)
  const activeWallStroke = canvasUnitsForCssPixels(4, editorScale)
  const openingRadius = canvasUnitsForCssPixels(7, editorScale)
  const openingStroke = canvasUnitsForCssPixels(2, editorScale)
  const labelOffset = canvasUnitsForCssPixels(10, editorScale)
  const labelSize = canvasUnitsForCssPixels(12, editorScale)

  const canExportModel = walls.length > 0
  const isExporting = exportingScope !== null
  const canExport2D = canExportModel && status === 'ready' && !isExporting
  const canExport3D =
    canExportModel &&
    webGLAvailable &&
    Boolean(threeRenderer?.gl) &&
    !isExporting

  useEffect(() => {
    if (!isE2EFixtureEnabled() || e2EProjectID()) return
    setSelectedFile(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAF0lEQVR4nGL6////fwZkwARjAAIAAP//YgEEAT/f/TcAAAAASUVORK5CYII='), (value) => value.charCodeAt(0))], 'e2e-wall-fixture.png', { type: 'image/png' }))
    setParseResponse(e2EFixture())
    setStatus('ready')
    setProjectName('Production E2E wall fixture')
  }, [])

  useEffect(() => {
    if (!isE2EInstrumentationEnabled()) return
    const positions = wasmGeometry?.getAttribute('position')
    const normals = wasmGeometry?.getAttribute('normal')
    const finite = Boolean(
      positions &&
      normals &&
      Array.from(positions.array).every(Number.isFinite) &&
      Array.from(normals.array).every(Number.isFinite),
    )
    const fingerprint = positions
      ? Array.from(positions.array).reduce((total, value, index) => total + value * (index + 1), 0)
      : 0
    window.__homevoxE2E = {
      generation: wasmGenerationRef.current,
      wasmCalls: wasmCallsRef.current,
      metrics: wasmMetrics,
      geometry: {
        positionCount: positions?.count ?? 0,
        normalCount: normals?.count ?? 0,
        finite,
        fingerprint,
      },
      currentProjectId: currentProject?.id ?? null,
      selectedOpeningId: selectedOpeningID,
      walls: walls.map((wall) => ({
        id: wall.id ?? null,
        x1: wall.x1,
        y1: wall.y1,
        x2: wall.x2,
        y2: wall.y2,
      })),
      openings: openings.map((opening) => ({
        id: opening.id ?? null,
        wallId: opening.wallId ?? null,
        position: opening.position ?? null,
        width: opening.width ?? null,
      })),
    }
  }, [currentProject, openings, selectedOpeningID, walls, wasmGeometry, wasmMetrics, wasmState])

  function buildScopeFileName(scope: '2d' | '3d'): string {
    exportSequenceRef.current += 1
    return buildExportFileName(scope, new Date(), exportSequenceRef.current)
  }

  useEffect(() => {
    const svg = editorRef.current
    if (!svg) return

    const updateSize = () => {
      const rect = svg.getBoundingClientRect()
      setEditorSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      )
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => {
    parseRequestRef.current?.controller.abort()
    projectRequestRef.current?.controller.abort()
  }, [])

  useEffect(() => () => {
    disposeWasmWallGeometry(wasmGeometryRef.current)
    wasmGeometryRef.current = null
  }, [])

  useEffect(() => {
    const generation = wasmGenerationRef.current + 1
    wasmGenerationRef.current = generation
    const replaceGeometry = (next: BufferGeometry | null) => {
      disposeWasmWallGeometry(wasmGeometryRef.current)
      wasmGeometryRef.current = next
      setWasmGeometry(next)
    }

    if (!wallVoxelModel) {
      replaceGeometry(null)
      setWasmMetrics(null)
      setWasmFallback(geometryValidationError ? 'invalid-input' : 'empty-model')
      setWasmState('fallback')
      return
    }
    let disposed = false
    setWasmState('loading')
    setWasmFallback(null)
    setWasmMetrics(null)
    void (async (model: WallVoxelModel) => {
      wasmCallsRef.current += 1
      const result = await runMarchingCubes(
        {
          data: model.data,
          dimensions: model.dimensions,
          isoLevel: model.isoLevel,
        },
        e2EWasmFailureEnabled() ? failingE2EWasmLoader : undefined,
      )
      if (disposed || wasmGenerationRef.current !== generation) return
      if (!result.ok) {
        replaceGeometry(null)
        setWasmFallback(result.reason)
        setWasmState('fallback')
        return
      }
      const nextGeometry = buildWasmWallGeometry(result.vertices, model)
      if (!nextGeometry) {
        replaceGeometry(null)
        setWasmFallback('invalid-output')
        setWasmState('fallback')
        return
      }
      if (disposed || wasmGenerationRef.current !== generation) {
        disposeWasmWallGeometry(nextGeometry)
        return
      }
      replaceGeometry(nextGeometry)
      setWasmMetrics(result.metrics)
      setWasmState('active')
    })(wallVoxelModel)

    return () => {
      disposed = true
    }
  }, [geometryValidationError, wallVoxelModel])

  useEffect(() => {
    void refreshProjects()
  }, [])

  useEffect(() => {
    const projectID = e2EProjectID()
    if (projectID) void handleLoadProject(projectID)
  }, [])

  useEffect(() => () => {
    if (previewURL) URL.revokeObjectURL(previewURL)
  }, [previewURL])

  useEffect(() => {
    if (!previewURL || svgUrlRef.current === previewURL) {
      return
    }

    const image = new Image()
    image.src = previewURL
    svgUrlRef.current = previewURL
    image.onload = () => {
      if (previewURL !== svgUrlRef.current) {
        return
      }
      setImageDimFallback({ width: image.naturalWidth, height: image.naturalHeight })
    }

    return () => {
      image.onload = null
    }
  }, [previewURL])

  useEffect(() => {
    if (!result) {
      setWallEditor(null)
      return
    }
    setWallEditor(createWallEditorState(result.walls, [...result.doors, ...result.windows], 6))
  }, [result])

  useEffect(() => {
    if (!wallEditor) {
      return
    }

    const handler = (event: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isInput =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement !== null && 'isContentEditable' in activeElement && activeElement.isContentEditable)
      if (isInput) {
        return
      }

      const isMod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (!isMod) {
        return
      }

      if (key === 'z' && !event.shiftKey) {
        if (wallEditor && canUndo(wallEditor)) {
          event.preventDefault()
          setWallEditor((prev) => (prev ? undoEditor(prev) : prev))
          setDragPreviewWalls(null)
          setDragPreviewOpenings(null)
        }
        return
      }

      if ((key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey)) {
        if (wallEditor && canRedo(wallEditor)) {
          event.preventDefault()
          setWallEditor((prev) => (prev ? redoEditor(prev) : prev))
          setDragPreviewWalls(null)
          setDragPreviewOpenings(null)
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
    }
  }, [wallEditor])

  async function handleParse() {
    if (!selectedFile) {
      setError('请先选择 PNG / JPG / WebP 户型图')
      setStatus('error')
      return
    }

    parseRequestRef.current?.controller.abort()
    const requestId = requestSequenceRef.current + 1
    requestSequenceRef.current = requestId
    const controller = new AbortController()
    parseRequestRef.current = { id: requestId, controller }

    setStatus('uploading')
    setError('')
    const formData = new FormData()
    formData.append('floorplan', selectedFile)

    try {
      const response = await fetch(API_PARSE_URL, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })
      const responseText = await response.text()
      let body: unknown = null
      try {
        body = responseText ? JSON.parse(responseText) : null
      } catch {
        // Reverse proxies and upstream failures can return non-JSON error pages.
      }
      if (!response.ok) {
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : responseText.trim() || response.statusText || '未知错误'
        throw new Error(`解析失败：HTTP ${response.status} ${message}`)
      }
      if (!isParseResponse(body)) {
        throw new Error('解析失败：服务返回的数据结构不完整或包含无效坐标')
      }
      if (parseRequestRef.current?.id !== requestId) return

      setParseResponse(body)
      setActiveStep(3)
      setCurrentProject(null)
      setProjectName((current) => current || body.filename)
      setStatus('ready')
      setDraggedEndpoint(null)
      setDragPreviewWalls(null)
      setHoveredEndpoint(null)
      setSelectedWallID(null)
      setSelectedOpeningID(null)
      setDraggedOpeningID(null)
      setDragPreviewOpenings(null)
      setOpeningError('')
      setExportError('')
    } catch (err) {
      if (controller.signal.aborted || parseRequestRef.current?.id !== requestId) return
      setError(err instanceof Error ? err.message : '解析失败')
      setStatus('error')
    } finally {
      if (parseRequestRef.current?.id === requestId) {
        parseRequestRef.current = null
      }
    }
  }

  function handleFileChange(file: File | null) {
    parseRequestRef.current?.controller.abort()
    parseRequestRef.current = null
    requestSequenceRef.current += 1
    setSelectedFile(file)
    setParseResponse(null)
    setWallEditor(null)
    setDragPreviewWalls(null)
    setHoveredEndpoint(null)
    setDraggedEndpoint(null)
    setSelectedWallID(null)
    setSelectedOpeningID(null)
    setDraggedOpeningID(null)
    setDragPreviewOpenings(null)
    setOpeningError('')
    setShowSourceImage(true)
    setError('')
    setExportError('')
    setStatus('idle')
    setImageDimFallback(null)
    setCurrentProject(null)
    setActiveStep(file ? 2 : 1)

    setPreviewURL((currentURL) => {
      if (currentURL) URL.revokeObjectURL(currentURL)
      return file ? URL.createObjectURL(file) : ''
    })
  }

  function beginProjectRequest(): { id: number; controller: AbortController } {
    projectRequestRef.current?.controller.abort()
    const request = { id: projectSequenceRef.current + 1, controller: new AbortController() }
    projectSequenceRef.current = request.id
    projectRequestRef.current = request
    return request
  }

  async function refreshProjects() {
    const request = beginProjectRequest()
    setProjectBusy('list')
    try {
      const items = await listProjects(request.controller.signal)
      if (projectRequestRef.current?.id === request.id) setProjects(items)
    } catch (err) {
      if (!request.controller.signal.aborted && projectRequestRef.current?.id === request.id) {
        setProjectMessage(`项目列表加载失败：${err instanceof Error ? err.message : '未知错误'}`)
      }
    } finally {
      if (projectRequestRef.current?.id === request.id) setProjectBusy(null)
    }
  }

  async function handleProjectSave() {
    if (!durableDocument) {
      setProjectMessage('请先完成户型解析后再创建项目')
      return
    }
    if (!projectName.trim()) {
      setProjectMessage('请输入项目名称')
      return
    }
    if (!currentProject && !selectedFile) {
      setProjectMessage('创建项目需要原始户型图')
      return
    }
    const request = beginProjectRequest()
    setProjectBusy('save')
    setProjectMessage('')
    try {
      const saved = currentProject
        ? await updateProject(currentProject.id, projectName, durableDocument, currentProject.revision, request.controller.signal)
        : await createProject(projectName, durableDocument, selectedFile!, request.controller.signal)
      if (projectRequestRef.current?.id !== request.id) return
      setCurrentProject(saved)
      setProjectName(saved.name)
      setProjectMessage(currentProject ? '项目已保存' : '项目已创建')
      setProjects((items) => [saved, ...items.filter((item) => item.id !== saved.id)])
    } catch (err) {
      if (!request.controller.signal.aborted && projectRequestRef.current?.id === request.id) {
        setProjectMessage(`项目保存失败：${err instanceof Error ? err.message : '未知错误'}`)
      }
    } finally {
      if (projectRequestRef.current?.id === request.id) setProjectBusy(null)
    }
  }

  async function handleLoadProject(id: string) {
    const request = beginProjectRequest()
    setProjectBusy('load')
    setProjectMessage('')
    try {
      const loaded = await getProject(id, request.controller.signal)
      const imageResponse = await fetch(loaded.sourceImageURL, { signal: request.controller.signal })
      if (!imageResponse.ok) throw new Error(`HTTP ${imageResponse.status}: 无法加载原始户型图`)
      const imageBlob = await imageResponse.blob()
      if (!imageBlob.type.startsWith('image/')) throw new Error('原始户型图不是受支持的图片')
      if (projectRequestRef.current?.id !== request.id) return
      const nextPreviewURL = URL.createObjectURL(imageBlob)
      setPreviewURL((currentURL) => {
        if (currentURL) URL.revokeObjectURL(currentURL)
        return nextPreviewURL
      })
      setSelectedFile(null)
      setParseResponse(loaded.document)
      setCurrentProject(loaded)
      setProjectName(loaded.name)
      setStatus('ready')
      setProjectMessage('项目已加载')
      setDraggedEndpoint(null)
      setDragPreviewWalls(null)
      setHoveredEndpoint(null)
      setSelectedWallID(null)
      setSelectedOpeningID(null)
      setDraggedOpeningID(null)
      setDragPreviewOpenings(null)
      setOpeningError('')
    } catch (err) {
      if (!request.controller.signal.aborted && projectRequestRef.current?.id === request.id) {
        setProjectMessage(`项目加载失败：${err instanceof Error ? err.message : '未知错误'}`)
      }
    } finally {
      if (projectRequestRef.current?.id === request.id) setProjectBusy(null)
    }
  }

  function handleUndo() {
    if (!wallEditor || !canUndo(wallEditor)) {
      return
    }
    setWallEditor(undoEditor(wallEditor))
    setDragPreviewWalls(null)
    setDragPreviewOpenings(null)
  }

  function handleRedo() {
    if (!wallEditor || !canRedo(wallEditor)) {
      return
    }
    setWallEditor(redoEditor(wallEditor))
    setDragPreviewWalls(null)
    setDragPreviewOpenings(null)
  }

  function handleCanvasPointerDown(event: PointerEvent<SVGElement>, endpoint: EndpointRef) {
    if (!wallEditor) return
    const svg = editorRef.current
    if (!svg) return

    const cursor = toCanvasPoint(event, svg, viewport)
    if (!hasFiniteCoordinate(cursor)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    setDraggedEndpoint(endpoint)
    setDragPreviewWalls(wallEditor.walls.map((wall) => ({ ...wall })))

    svg.setPointerCapture(event.pointerId)
  }

  function handleCanvasPointerMove(event: PointerEvent<SVGSVGElement>) {
    const svg = editorRef.current
    if (!svg || !wallEditor) {
      return
    }

    const cursor = toCanvasPoint(event, svg, viewport)
    if (!hasFiniteCoordinate(cursor)) {
      if (!draggedEndpoint) setHoveredEndpoint(null)
      return
    }

    if (draggedEndpoint) {
      const moveResult = moveEndpoint(wallEditor, draggedEndpoint, cursor)
      const openingValidationError = moveResult.changed
        ? validateOpenings(moveResult.walls, wallEditor.openings)
        : null
      if (openingValidationError) {
        setDragPreviewWalls(null)
        setOpeningError(openingValidationError)
        return
      }
      setDragPreviewWalls(moveResult.changed ? moveResult.walls : null)
      setOpeningError('')
      return
    }

    if (draggedOpeningID) {
      const opening = wallEditor.openings.find((item) => item.id === draggedOpeningID)
      const wall = opening?.wallId ? wallEditor.walls.find((item) => item.id === opening.wallId) : undefined
      if (!opening || !wall) return
      const dx = wall.x2 - wall.x1
      const dy = wall.y2 - wall.y1
      const lengthSq = dx * dx + dy * dy
      if (!Number.isFinite(lengthSq) || lengthSq <= 0) return
      const position = ((cursor.x - wall.x1) * dx + (cursor.y - wall.y1) * dy) / lengthSq
      const edit = updateOpening(wallEditor, draggedOpeningID, { position })
      if (edit.error) setOpeningError(edit.error)
      else { setDragPreviewOpenings(edit.openings); setOpeningError('') }
      return
    }

    const hit = pickEndpoint(walls, cursor, hitRadius)
    setHoveredEndpoint(hit)
  }

  function selectWall(wallID: string) {
    setSelectedWallID(wallID)
    setSelectedOpeningID(null)
    setOpeningError('')
  }

  function selectOpening(openingID: string) {
    const opening = openings.find((item) => item.id === openingID)
    setSelectedOpeningID(openingID)
    setSelectedWallID(opening?.wallId ?? null)
    setOpeningError('')
  }

  function handleWallPointerDown(event: PointerEvent<SVGLineElement>, wallID: string) {
    event.preventDefault()
    event.stopPropagation()
    selectWall(wallID)
  }

  function commitOpeningPatch(openingID: string, patch: Partial<ParsedOpening>) {
    if (!wallEditor) return
    const edit = updateOpening(wallEditor, openingID, patch)
    if (edit.error) {
      setOpeningError(edit.error)
      return
    }
    if (edit.changed) setWallEditor(pushWallSnapshot(wallEditor, wallEditor.walls, edit.openings))
    setOpeningError('')
  }

  function handleAddOpening(kind: 'door' | 'window') {
    if (!wallEditor || !selectedWallID) {
      setOpeningError('请先选择一面墙再添加开口')
      return
    }
    const wall = wallEditor.walls.find((item) => item.id === selectedWallID)
    if (!wall?.id) {
      setOpeningError('所选墙体没有稳定 ID，无法添加开口')
      return
    }
    const idBase = `${kind}-manual`
    const id = `${idBase}-${wallEditor.openings.filter((opening) => opening.id?.startsWith(idBase)).length + 1}`
    for (const position of [0.5, 0.25, 0.75]) {
      const edit = addOpening(wallEditor, { id, kind, wallId: wall.id, position, width: MIN_OPENING_WIDTH, source: 'manual', confirmed: false })
      if (!edit.error) {
        setWallEditor(pushWallSnapshot(wallEditor, wallEditor.walls, edit.openings))
        setSelectedOpeningID(id)
        setOpeningError('')
        return
      }
    }
    setOpeningError('该墙没有可用空间添加最小开口')
  }

  function handleDeleteOpening() {
    if (!wallEditor || !selectedOpeningID) return
    const edit = removeOpening(wallEditor, selectedOpeningID)
    if (edit.error) { setOpeningError(edit.error); return }
    setWallEditor(pushWallSnapshot(wallEditor, wallEditor.walls, edit.openings))
    setSelectedOpeningID(null)
    setOpeningError('')
  }

  function handleOpeningPointerDown(event: PointerEvent<SVGCircleElement>, openingID: string) {
    if (!wallEditor || !wallEditor.openings.some((opening) => opening.id === openingID)) return
    const svg = editorRef.current
    if (!svg) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedOpeningID(openingID)
    setDraggedOpeningID(openingID)
    setDragPreviewOpenings(wallEditor.openings.map((opening) => ({ ...opening })))
    setOpeningError('')
    svg.setPointerCapture(event.pointerId)
  }

  function commitDrag(pointerId?: number) {
    if (!wallEditor) {
      setDraggedEndpoint(null)
      setDraggedOpeningID(null)
      setDragPreviewWalls(null)
      setDragPreviewOpenings(null)
      return
    }
    if (draggedEndpoint && dragPreviewWalls) {
      const openingValidationError = validateOpenings(dragPreviewWalls, wallEditor.openings)
      if (openingValidationError) {
        setOpeningError(openingValidationError)
      } else {
        setWallEditor(pushWallSnapshot(wallEditor, dragPreviewWalls, wallEditor.openings))
        setOpeningError('')
      }
    }
    if (draggedOpeningID && dragPreviewOpenings) setWallEditor(pushWallSnapshot(wallEditor, wallEditor.walls, dragPreviewOpenings))
    setDraggedEndpoint(null)
    setDraggedOpeningID(null)
    setDragPreviewWalls(null)
    setDragPreviewOpenings(null)
    if (pointerId !== undefined) {
      const svg = editorRef.current
      if (svg?.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId)
    }
  }

  function handleCanvasPointerUp(event: PointerEvent<SVGSVGElement>) { commitDrag(event.pointerId) }

  function handleCanvasPointerCancel(event: PointerEvent<SVGSVGElement>) {
    setDraggedEndpoint(null)
    setDraggedOpeningID(null)
    setDragPreviewWalls(null)
    setDragPreviewOpenings(null)
    const svg = editorRef.current
    if (svg?.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
  }

  async function handleExport2D() {
    if (!canExport2D || !editorRef.current) {
      return
    }

    setExportingScope('2d')
    setExportError('')

    try {
      const fileName = buildScopeFileName('2d')
      const size = validateCanvasSize(viewport.width, viewport.height)
      if (!size.ok) {
        setExportError(size.error.message)
        return
      }

      const exportResult = await exportSvgElementToPng(editorRef.current, size.value.width, size.value.height, fileName)
      if (!exportResult.ok) {
        setExportError(exportResult.error.message)
        return
      }

      downloadBlobAsPng(exportResult.value)
    } catch (error) {
      setExportError(`2D 导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setExportingScope(null)
    }
  }

  async function handleExport3D() {
    if (!canExport3D || !threeRenderer) {
      return
    }

    setExportingScope('3d')
    setExportError('')

    try {
      const rendererState = threeRenderer
      rendererState.gl.render(rendererState.scene, rendererState.camera)
      const fileName = buildScopeFileName('3d')
      const exportResult = await exportWebGLCanvasToPng(rendererState.gl, fileName)
      if (!exportResult.ok) {
        setExportError(exportResult.error.message)
        return
      }

      downloadBlobAsPng(exportResult.value)
    } catch (error) {
      setExportError(`3D 导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setExportingScope(null)
    }
  }

  const twoDPanel = (
    <section className="workspace-card canvas-card min-w-0 p-3" aria-label="2D 墙体编辑器">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">2D 结构 · 原图叠加校正</span>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-slate-600"><input type="checkbox" checked={showSourceImage} onChange={(event) => setShowSourceImage(event.target.checked)} />显示底图</label>
          <span>{draggedEndpoint ? '拖拽中' : selectedWall ? `已选择 ${selectedWall.id}` : hoveredEndpoint ? '可拖拽端点（鼠标悬停）' : '选择墙体或拖拽端点'}</span>
        </div>
      </div>
      <div className="h-[calc(100%-32px)] overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
        <svg ref={editorRef} className="h-full w-full touch-none" viewBox={`${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`} role="img" aria-label="户型图墙体端点编辑区" onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerUp} onPointerCancel={handleCanvasPointerCancel} onPointerLeave={handleCanvasPointerCancel} preserveAspectRatio="xMinYMin meet">
          <rect x={viewport.minX} y={viewport.minY} width={viewport.width} height={viewport.height} fill="#0f172a" />
          {showSourceImage && previewURL && <image href={previewURL} x={viewport.minX} y={viewport.minY} width={viewport.width} height={viewport.height} preserveAspectRatio="xMinYMin meet" opacity="0.42" pointerEvents="none" />}
          <g aria-label="墙体可视层" pointerEvents="none">
            {walls.map((wall, wallIndex) => {
              const endpointActive = hoveredEndpoint?.wallIndex === wallIndex || draggedEndpoint?.wallIndex === wallIndex
              const selected = selectedWallID === wall.id
              const active = endpointActive || selected
              const color = draggedEndpoint?.wallIndex === wallIndex ? '#22d3ee' : selected ? '#fbbf24' : endpointActive ? '#38bdf8' : '#e2e8f0'
              return <line key={wall.id ?? `wall-${wallIndex}`} x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2} stroke={color} strokeWidth={active ? activeWallStroke : wallStroke} />
            })}
          </g>
          <g aria-label="墙体透明命中层" fill="none" stroke="transparent" strokeLinecap="round">
            {walls.map((wall, wallIndex) => <line key={`hit-${wall.id ?? wallIndex}`} data-testid={`wall-hit-${wall.id ?? wallIndex}`} data-selected={selectedWallID === wall.id ? 'true' : 'false'} x1={wall.x1} y1={wall.y1} x2={wall.x2} y2={wall.y2} strokeWidth={wallHitStroke} onPointerDown={(event) => wall.id && handleWallPointerDown(event, wall.id)} style={{ cursor: 'pointer' }} />)}
          </g>
          <g aria-label="端点可视层" pointerEvents="none">
            {walls.flatMap((wall, wallIndex) => ([{ endpoint: 'start' as const, x: wall.x1, y: wall.y1 }, { endpoint: 'end' as const, x: wall.x2, y: wall.y2 }].map((handle) => {
              const highlighted = hoveredEndpoint?.wallIndex === wallIndex && hoveredEndpoint.endpoint === handle.endpoint || draggedEndpoint?.wallIndex === wallIndex && draggedEndpoint.endpoint === handle.endpoint
              return <circle key={`visible-${wallIndex}-${handle.endpoint}`} cx={handle.x} cy={handle.y} r={highlighted ? activeHandleRadius : handleRadius} fill={highlighted ? '#f8fafc' : '#38bdf8'} stroke={highlighted ? '#0f172a' : '#7dd3fc'} strokeWidth={openingStroke} />
            })))}
          </g>
          <g aria-label="端点透明命中层" fill="transparent" stroke="transparent">
            {walls.flatMap((wall, wallIndex) => ([{ endpoint: 'start' as const, x: wall.x1, y: wall.y1 }, { endpoint: 'end' as const, x: wall.x2, y: wall.y2 }].map((handle) => <circle key={`hit-${wallIndex}-${handle.endpoint}`} data-testid={`endpoint-handle-${wallIndex}-${handle.endpoint}`} cx={handle.x} cy={handle.y} r={hitRadius} onPointerDown={(event) => handleCanvasPointerDown(event, { wallIndex, endpoint: handle.endpoint })} style={{ cursor: 'grab' }} />)))}
          </g>
          {openings.map((opening) => {
            const wall = opening.wallId ? walls.find((item) => item.id === opening.wallId) : undefined
            const point = wall ? openingPoint(wall, opening) : null
            if (!point || !opening.id) return null
            const selected = selectedOpeningID === opening.id
            const color = selected ? '#facc15' : opening.kind === 'door' ? '#f97316' : '#38bdf8'
            return <g key={opening.id} data-testid={`opening-${opening.id}`}><circle data-testid={`opening-handle-${opening.id}`} cx={point.x} cy={point.y} r={selected ? openingRadius * 1.3 : openingRadius} fill={color} fillOpacity={selected ? 0.95 : 0.75} stroke="#f8fafc" strokeWidth={openingStroke} onPointerDown={(event) => handleOpeningPointerDown(event, opening.id!)} style={{ cursor: 'grab' }} />{openingLabel(opening) && <text x={point.x + labelOffset} y={point.y - labelOffset} fill={color} fontSize={labelSize} pointerEvents="none">{openingLabel(opening)}</text>}</g>
          })}
        </svg>
      </div>
    </section>
  )

  const threeDPanel = (
    <main className="three-card relative min-h-[520px] min-w-0 overflow-hidden" aria-label="3D 户型预览">
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl bg-black/60 px-3 py-2 text-xs text-white/75">
        <div className="font-medium text-white/90">3D 空间 · 同源可编辑预览</div>
        <p className="mt-1 text-[11px] text-white/65">选择墙体、门窗可在两个视图中保持一致。</p>
        {geometryValidationError && <p className="mt-1 max-w-xs text-[11px] text-amber-200" role="alert">当前开口数据无法生成 3D，请返回 2D 校正后重试。</p>}
      </div>
      <div className="h-full w-full">
        {webGLAvailable ? <Canvas camera={{ position: [8, 7, 8], fov: 50 }} shadows gl={{ antialias: true, preserveDrawingBuffer: true }} onCreated={setThreeRenderer}>
          <Suspense fallback={null}><Scene model={wallShellModel} wasmGeometry={wasmGeometry} wasmActive={wasmState === 'active'} selectedWallID={selectedWallID} selectedOpeningID={selectedOpeningID} onSelectWall={selectWall} onSelectOpening={selectOpening} /><OrbitControls makeDefault /></Suspense>
        </Canvas> : <div className="flex h-full w-full items-center justify-center px-8 text-center" role="status" aria-label="3D 渲染不可用"><div className="max-w-sm rounded-2xl border border-amber-400/25 bg-amber-950/30 px-5 py-4 text-sm leading-6 text-amber-100">当前浏览器无法显示 3D 预览。请在启用 WebGL 的浏览器中打开；2D 校正仍可继续。</div></div>}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-xl bg-black/55 px-3 py-2 text-center text-xs text-white/50">墙体高度为示意；精确高度、承重属性、墙厚与窗台高度需实测。</div>
    </main>
  )

  const threeDUnavailablePanel = (
    <div className="workspace-card p-6 text-slate-800" role={wasmState === 'loading' ? 'status' : 'alert'}>
      {geometryValidationError ? (
        <>
          <h4 className="text-lg font-semibold">当前开口数据无法生成 3D</h4>
          <p className="mt-2 text-sm text-slate-600">请返回 2D 校正后修复数据，再重新生成 3D。</p>
        </>
      ) : wasmState === 'loading' ? (
        <>
          <h4 className="text-lg font-semibold">正在准备 3D 预览</h4>
          <p className="mt-2 text-sm text-slate-600">3D 几何准备完成后，才能打开联动工作台。</p>
        </>
      ) : (
        <>
          <h4 className="text-lg font-semibold">当前 3D 预览不可用</h4>
          <p className="mt-2 text-sm text-slate-600">无法生成可靠的 3D 几何。请返回 2D 校正后重试，或在支持 WebGL 的浏览器中打开。</p>
        </>
      )}
      <button type="button" className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => setActiveStep(3)}>返回 2D 校正</button>
    </div>
  )

  const editorInspector = (
    <aside className="workspace-card inspector-card min-w-0 p-4 text-slate-800">
      <section className="space-y-3 text-xs">
        <div><h3 className="text-base font-semibold">对象检查器</h3><p className="mt-1 text-slate-500">选择 2D 或 3D 中的对象以查看同一个稳定标识。</p></div>
        <div className="rounded-xl bg-slate-50 p-3" aria-label="墙体对象上下文"><p className="text-slate-500">当前墙体</p><p data-testid="selected-wall-id" className="mt-1 font-semibold text-slate-900">{selectedWall?.id ?? '未选择'}</p>{selectedOpening && <p data-testid="selected-opening-id" className="mt-2 text-slate-600">开口：{selectedOpening.id} · 归属：{selectedOpening.wallId ?? '未知'}</p>}</div>
        <div className="rounded-xl bg-slate-50 p-3" aria-label="开口编辑器"><p className="mb-2 text-slate-500">门窗开口</p><div className="grid grid-cols-2 gap-2"><button type="button" className="rounded-lg bg-orange-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => handleAddOpening('door')}>添加门</button><button type="button" className="rounded-lg bg-sky-600 px-3 py-2 text-white disabled:opacity-50" disabled={!selectedWallID} onClick={() => handleAddOpening('window')}>添加窗</button></div>{selectedOpening && <div className="mt-2 grid grid-cols-[1fr_auto] gap-2"><label className="text-slate-600">宽度<input aria-label="开口宽度" data-testid="opening-width" className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-slate-900" type="number" min={MIN_OPENING_WIDTH} step="1" value={selectedOpening.width ?? ''} onChange={(event) => { const width = Number(event.target.value); if (Number.isFinite(width)) commitOpeningPatch(selectedOpening.id!, { width }) }} /></label><button type="button" className="self-end rounded-lg bg-red-700 px-3 py-2 text-white" onClick={handleDeleteOpening}>删除</button>{selectedOpening.kind === 'window' && <p className="unknown-note col-span-2 p-2" data-testid="window-preview-disclosure" role="status">窗台高和窗高未知。3D 预览使用未持久化的示意值，不会保存为建筑参数。</p>}{selectedOpening.kind === 'door' && selectedOpening.confirmed !== true && <p className="unknown-note col-span-2 p-2" data-testid="door-preview-disclosure" role="status">门高未知。3D 全高门洞仅为预览示意，不会保存为建筑参数。</p>}</div>}{openingError && <p role="alert" className="mt-2 text-amber-700">{openingError}</p>}</div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="mb-2 text-slate-500">导出当前视图</p><div className="grid grid-cols-2 gap-2"><button aria-label="导出2D平面图PNG" className="rounded-lg bg-emerald-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport2D} onClick={handleExport2D}>{exportingScope === '2d' ? '导出中…' : '导出2D PNG'}</button><button aria-label="导出3D白模PNG" className="rounded-lg bg-sky-600 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canExport3D} onClick={handleExport3D}>{exportingScope === '3d' ? '导出中…' : '导出3D PNG'}</button></div>{exportError && <p role="alert" className="mt-2 text-amber-700">{exportError}</p>}</div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="mb-2 text-slate-500">编辑历史</p><div className="grid grid-cols-2 gap-2"><button aria-label="撤销（Ctrl/Cmd + Z）" className="rounded-lg bg-slate-800 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canUndo(wallEditor)} onClick={handleUndo}>Undo</button><button aria-label="重做（Ctrl/Cmd + Shift+Z 或 Ctrl/Cmd + Y）" className="rounded-lg bg-slate-800 px-3 py-2 text-white disabled:opacity-50" type="button" disabled={!canRedo(wallEditor)} onClick={handleRedo}>Redo</button></div></div>
      </section>
    </aside>
  )

  const savePanel = (
    <section className="workspace-card mx-auto w-full max-w-2xl p-6 text-slate-800"><h3 className="text-xl font-semibold">保存项目</h3><p className="mt-2 text-sm text-slate-500">手动保存当前同源 2D 与 3D 数据。保存不可用时会保留当前编辑，不会假装成功。</p><div className="mt-6 space-y-3"><input aria-label="项目名称" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" value={projectName} maxLength={120} placeholder="项目名称" onChange={(event) => setProjectName(event.target.value)} /><button className="w-full rounded-lg bg-violet-600 px-3 py-2 font-medium text-white disabled:opacity-50" type="button" disabled={!durableDocument || projectBusy !== null} onClick={() => void handleProjectSave()}>{projectBusy === 'save' ? '保存中…' : currentProject ? `保存项目（r${currentProject.revision}）` : '创建项目'}</button>{projectMessage && <p role="status" className="text-sm text-slate-700">{projectMessage}</p>}<div className="border-t border-slate-200 pt-4"><div className="mb-2 flex items-center justify-between"><h4 className="font-semibold">已保存项目</h4><button className="rounded-md border border-slate-300 px-2 py-1 text-xs" type="button" disabled={projectBusy !== null} onClick={() => void refreshProjects()}>{projectBusy === 'list' ? '刷新中…' : '刷新'}</button></div><ul className="space-y-2" aria-label="已保存项目">{projects.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2"><span>{item.name} <span className="text-slate-500">r{item.revision}</span></span><button className="rounded-md bg-sky-700 px-2 py-1 text-xs text-white" type="button" disabled={projectBusy !== null} onClick={() => void handleLoadProject(item.id)}>加载</button></li>)}{projects.length === 0 && <li className="text-sm text-slate-500">暂无已保存项目</li>}</ul></div></div></section>
  )

  const goNext = () => {
    if (activeStep === 1 && selectedFile) setActiveStep(2)
    else if (activeStep === 3) setActiveStep(4)
    else if (activeStep === 5) setActiveStep(6)
  }

  return (
    <div className="homevox-app"><div className="homevox-layout min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="product-sidebar flex flex-col px-4 py-6"><div className="mb-8 px-2"><p className="text-xs font-semibold tracking-[0.22em] text-indigo-200">HOMEVOX</p><h1 className="mt-2 text-xl font-bold">筑居</h1><p className="mt-2 text-xs leading-5 text-indigo-100/75">从真实户型图到可编辑空间</p></div><nav className="space-y-2" aria-label="产品步骤">{PRODUCT_STEPS.map((step) => { const unlocked = canOpenStep(step.id, Boolean(durableDocument)) && (step.id !== 5 || canOpenLinkedWorkspace); return <button key={step.id} className="product-step flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium disabled:cursor-not-allowed" type="button" data-active={activeStep === step.id} data-locked={!unlocked} aria-current={activeStep === step.id ? 'step' : undefined} disabled={!unlocked} onClick={() => setActiveStep(step.id)}><span className="step-dot">{step.id}</span><span>{step.label}</span></button> })}</nav><div className="mt-auto rounded-xl border border-white/10 bg-white/8 p-3 text-xs leading-5 text-indigo-100/80">空间设计沟通工具，不是施工 CAD。未知建筑属性会保持未知，需现场实测。</div></aside>
      <div className="flex min-h-screen min-w-0 flex-col"><header className="product-topbar flex min-h-[72px] items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8"><div><p className="text-xs font-medium text-violet-600">步骤 {activeStep} / 6</p><h2 className="mt-1 text-lg font-bold text-slate-900">{PRODUCT_STEPS[activeStep - 1].label}</h2></div><div className="flex items-center gap-2">{durableDocument && <span className="status-chip px-3 py-1.5 text-xs font-medium">同一份空间数据</span>}{(activeStep === 1 || activeStep === 3 || activeStep === 5) && <button className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" type="button" disabled={activeStep === 1 ? !selectedFile : !durableDocument} onClick={goNext}>{activeStep === 1 ? '继续到 AI 识别' : '继续'}</button>}</div></header>
      <div className="min-h-0 flex-1 p-4">
        {activeStep === 1 && <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800"><h3 className="text-xl font-semibold">导入真实户型图</h3><p className="mt-2 text-sm text-slate-500">从你的图纸开始，不套用示意户型。</p><label className="mt-6 block cursor-pointer rounded-xl border border-dashed border-slate-400 bg-slate-50 p-5 text-sm hover:border-violet-500"><span className="block font-medium">选择户型图</span><span className="mt-1 block text-xs text-slate-500">支持 PNG、JPEG、GIF、WebP；后端限制 10 MiB</span><input className="mt-3 block w-full text-xs" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} /></label>{previewURL && <img className="mt-4 max-h-80 w-full rounded-xl object-contain bg-slate-50" src={previewURL} alt="上传户型图预览" />}</section>}
        {activeStep === 2 && <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800"><h3 className="text-xl font-semibold">AI 识别</h3><p className="mt-2 text-sm text-slate-500">识别完成后才会打开可校正的同源 2D 数据。</p><button className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={status === 'uploading' || !selectedFile} onClick={handleParse}>{status === 'uploading' ? 'AI 识别中…' : '开始 AI 识别'}</button><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">识别状态：</span>{status === 'ready' ? '解析完成' : status === 'uploading' ? '解析中' : status === 'error' ? '失败' : '等待开始'}{error && <p role="alert" className="mt-2 text-red-700">{error}</p>}</div>{status === 'error' && selectedFile && <button type="button" className="mt-3 rounded-lg border border-violet-300 px-3 py-2 text-sm text-violet-700" onClick={handleParse}>重试 AI 识别</button>}</section>}
        {activeStep === 3 && <div className="workspace-grid product-workspace">{twoDPanel}{editorInspector}</div>}
        {activeStep === 4 && <section className="mx-auto max-w-5xl"><div className="mb-4 flex items-center justify-between rounded-xl bg-white p-4 shadow-sm"><div><h3 className="font-semibold text-slate-900">确认 3D 空间</h3><p className="mt-1 text-sm text-slate-500">这是同一份已校正 2D 数据生成的真实 3D 预览。</p></div><div className="flex gap-2"><button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => setActiveStep(3)}>返回 2D 校正</button>{canOpenLinkedWorkspace && <button type="button" className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => setActiveStep(5)}>完成并打开 3D</button>}</div></div>{canOpenLinkedWorkspace ? threeDPanel : threeDUnavailablePanel}</section>}
        {activeStep === 5 && (canOpenLinkedWorkspace ? <div className="workspace-grid product-workspace product-workspace-linked">{twoDPanel}{threeDPanel}{editorInspector}</div> : <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800" role="alert"><h3 className="text-lg font-semibold">当前 3D 预览不可用</h3><p className="mt-2 text-sm text-slate-600">联动工作台已关闭，请先返回 2D 校正。</p><button type="button" className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => setActiveStep(3)}>返回 2D 校正</button></section>)}
        {activeStep === 6 && savePanel}
      </div></div>
    </div></div>
  )
}
