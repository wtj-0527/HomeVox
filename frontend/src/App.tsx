import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Canvas, type RootState } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import type { BufferGeometry } from 'three'
import {
  type EndpointRef,
  type WallSegment,
  canRedo,
  canUndo,
  createWallEditorState,
  moveEndpoint,
  pushWallSnapshot,
  redo as redoEditor,
  undo as undoEditor,
  type WallEditorState,
} from './floorplanEditor'
import {
  canvasScale,
  canvasUnitsForCssPixels,
  isParseResponse,
  openingLabel,
  type ParseResponse,
  type ParseResult,
  type Viewport,
} from './floorplanUi'
import { buildWallShellModel, type WallShellModel } from './wallShell'
import { buildWallVoxelModel, type WallVoxelModel } from './wallVoxel'
import { runMarchingCubes, type MarchingCubesMetrics, type WasmFallbackReason } from './wasmMarchingCubes'
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

const API_PARSE_URL = '/api/floorplans/parse'
const EMPTY_WALLS: WallSegment[] = []
const E2E_WALL_FIXTURE: ParseResponse = {
  filename: 'e2e-wall-fixture.png',
  contentType: 'image/png',
  size: 1,
  result: {
    rooms: [],
    walls: [
      { x1: 80, y1: 80, x2: 520, y2: 80 },
      { x1: 520, y1: 80, x2: 520, y2: 360 },
      { x1: 520, y1: 360, x2: 80, y2: 360 },
      { x1: 80, y1: 360, x2: 80, y2: 80 },
    ],
    doors: [],
    windows: [],
    scale: { unit: 'px' },
    metadata: { source: 'production-e2e-fixture', image_width: 600, image_height: 440 },
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
      geometry: { positionCount: number; normalCount: number; finite: boolean }
    }
  }
}

function isE2EFixtureEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('e2e') === 'wall-fixture'
}

function isE2EFallbackForced(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('wasm') === 'fallback'
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
}

function Scene({ model, wasmGeometry, wasmActive }: FloorplanSceneProps) {

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

      {!wasmActive && model.walls.map((wall) => (
        <mesh
          key={`wall-shell-${wall.sourceIndex}`}
          position={[wall.x, wall.height / 2, wall.z]}
          rotation={[0, wall.rotationY, 0]}
          castShadow
          receiveShadow
          userData={{ sourceWallIndex: wall.sourceIndex }}
        >
          <boxGeometry args={[wall.length, wall.height, wall.thickness]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.72} />
        </mesh>
      ))}

      {model.openings.map((opening) => {
        const isDoor = opening.kind === 'door'
        const markerHeight = isDoor ? 3.2 : 3.7
        const markerRadius = isDoor ? 0.28 : 0.24
        return (
          <mesh
            key={`${opening.kind}-${opening.sourceIndex}`}
            position={[opening.x, markerHeight, opening.z]}
            renderOrder={10}
            userData={{ openingKind: opening.kind, label: opening.label }}
          >
            <sphereGeometry args={[markerRadius, 20, 14]} />
            <meshBasicMaterial
              color={isDoor ? '#f97316' : '#38bdf8'}
              depthTest={false}
              toneMapped={false}
            />
          </mesh>
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
  const [selectedWallIndex, setSelectedWallIndex] = useState<number | null>(null)
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
  const [wasmFallback, setWasmFallback] = useState<WasmFallbackReason | null>(null)
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

  const editableResult = useMemo<ParseResult | null>(() => {
    if (!parseResponse) return null
    return {
      ...parseResponse.result,
      walls,
    }
  }, [parseResponse, walls])
  const durableDocument = useMemo<ParseResponse | null>(() => (
    parseResponse ? { ...parseResponse, result: { ...parseResponse.result, walls } } : null
  ), [parseResponse, walls])
  const wallShellModel = useMemo(
    () => buildWallShellModel(walls, result?.doors ?? [], result?.windows ?? []),
    [walls, result?.doors, result?.windows],
  )
  const wallShellTotalLength = useMemo(
    () => wallShellModel.walls.reduce((total, wall) => total + wall.length, 0),
    [wallShellModel],
  )
  const wallVoxelModel = useMemo(() => buildWallVoxelModel(walls), [walls])

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
    if (!isE2EFixtureEnabled()) return
    setParseResponse(E2E_WALL_FIXTURE)
    setStatus('ready')
    setProjectName('Production E2E wall fixture')
  }, [])

  useEffect(() => {
    if (!isE2EFixtureEnabled()) return
    const positions = wasmGeometry?.getAttribute('position')
    const normals = wasmGeometry?.getAttribute('normal')
    const finite = Boolean(
      positions &&
      normals &&
      Array.from(positions.array).every(Number.isFinite) &&
      Array.from(normals.array).every(Number.isFinite),
    )
    window.__homevoxE2E = {
      generation: wasmGenerationRef.current,
      wasmCalls: wasmCallsRef.current,
      metrics: wasmMetrics,
      geometry: {
        positionCount: positions?.count ?? 0,
        normalCount: normals?.count ?? 0,
        finite,
      },
    }
  }, [wasmGeometry, wasmMetrics, wasmState])

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
      setWasmFallback('empty-model')
      setWasmState('fallback')
      return
    }
    if (isE2EFallbackForced()) {
      replaceGeometry(null)
      setWasmMetrics(null)
      setWasmFallback('load-failed')
      setWasmState('fallback')
      return
    }

    let disposed = false
    setWasmState('loading')
    setWasmFallback(null)
    setWasmMetrics(null)
    void (async (model: WallVoxelModel) => {
      wasmCallsRef.current += 1
      const result = await runMarchingCubes({
        data: model.data,
        dimensions: model.dimensions,
        isoLevel: model.isoLevel,
      })
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
  }, [wallVoxelModel])

  useEffect(() => {
    void refreshProjects()
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
    setWallEditor(createWallEditorState(result.walls, 6))
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
        }
        return
      }

      if ((key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey)) {
        if (wallEditor && canRedo(wallEditor)) {
          event.preventDefault()
          setWallEditor((prev) => (prev ? redoEditor(prev) : prev))
          setDragPreviewWalls(null)
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
      setCurrentProject(null)
      setProjectName((current) => current || body.filename)
      setStatus('ready')
      setDraggedEndpoint(null)
      setDragPreviewWalls(null)
      setHoveredEndpoint(null)
      setSelectedWallIndex(null)
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
    setSelectedWallIndex(null)
    setShowSourceImage(true)
    setError('')
    setExportError('')
    setStatus('idle')
    setImageDimFallback(null)
    setCurrentProject(null)

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
      setSelectedWallIndex(null)
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
  }

  function handleRedo() {
    if (!wallEditor || !canRedo(wallEditor)) {
      return
    }
    setWallEditor(redoEditor(wallEditor))
    setDragPreviewWalls(null)
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
      setDragPreviewWalls(moveResult.changed ? moveResult.walls : null)
      return
    }

    const hit = pickEndpoint(walls, cursor, hitRadius)
    setHoveredEndpoint(hit)
  }

  function handleWallPointerDown(event: PointerEvent<SVGLineElement>, wallIndex: number) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedWallIndex(wallIndex)
  }

  function commitDrag(pointerId?: number) {
    if (!wallEditor) {
      setDraggedEndpoint(null)
      setDragPreviewWalls(null)
      return
    }

    if (draggedEndpoint && dragPreviewWalls) {
      setWallEditor((prev) => (prev ? pushWallSnapshot(prev, dragPreviewWalls) : prev))
    }

    setDraggedEndpoint(null)
    setDragPreviewWalls(null)

    if (pointerId !== undefined) {
      const svg = editorRef.current
      if (svg?.hasPointerCapture(pointerId)) {
        svg.releasePointerCapture(pointerId)
      }
    }
  }

  function handleCanvasPointerUp(event: PointerEvent<SVGSVGElement>) {
    commitDrag(event.pointerId)
  }

  function handleCanvasPointerCancel(event: PointerEvent<SVGSVGElement>) {
    if (draggedEndpoint) {
      setDraggedEndpoint(null)
      setDragPreviewWalls(null)
    }
    const svg = editorRef.current
    if (svg?.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId)
    }
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

  return (
    <div className="w-full h-full bg-slate-950 text-slate-100">
      <div className="absolute top-0 left-0 right-0 z-10 bg-black/50 backdrop-blur-sm px-5 py-3 flex items-center justify-between border-b border-white/10">
        <span className="text-sm font-medium text-white/85">筑居 HomeVox — 2D 校正、3D 墙体白模与 PNG 导出</span>
        <span className="text-xs text-white/50">0.0.0.0:18088 API · React/R3F Viewport</span>
      </div>

      <aside className="absolute left-4 top-20 bottom-4 z-10 w-[380px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/90 p-4 shadow-2xl backdrop-blur">
        <section className="space-y-3">
          <div>
            <h1 className="text-lg font-semibold">户型图上传与 AI 解析</h1>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              上传图片后由 Go API 解析出 rooms / walls / doors / windows，后续 2D 端点可拖拽修正。
            </p>
          </div>

          <label className="block rounded-xl border border-dashed border-slate-600 bg-slate-950/60 p-4 text-sm cursor-pointer hover:border-sky-400">
            <span className="block font-medium text-slate-200">选择户型图</span>
            <span className="mt-1 block text-xs text-slate-500">支持 PNG、JPEG、GIF、WebP；后端限制 10 MiB</span>
            <input
              className="mt-3 block w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500 file:px-3 file:py-2 file:text-white"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
            />
          </label>

          {previewURL && (
            <img className="max-h-52 w-full rounded-xl object-contain bg-white" src={previewURL} alt="上传户型图预览" />
          )}

          <button
            className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700"
            type="button"
            disabled={status === 'uploading' || !selectedFile}
            onClick={handleParse}
          >
            {status === 'uploading' ? '上传并解析中…' : '上传并解析'}
          </button>

          <div className="rounded-xl bg-slate-950/70 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">状态</span>
              <span
                className={
                  status === 'error' ? 'text-red-300' : status === 'ready' ? 'text-emerald-300' : 'text-slate-200'
                }
              >
                {status === 'ready'
                  ? '解析完成'
                  : status === 'uploading'
                    ? '解析中'
                    : status === 'error'
                      ? '失败'
                      : '等待上传'}
              </span>
            </div>
            {error && <p className="mt-2 leading-5 text-red-300">{error}</p>}
            {exportError && <p className="mt-2 leading-5 text-amber-300">{exportError}</p>}
          </div>
        </section>

        <section className="mt-4 space-y-3 rounded-xl border border-white/10 bg-slate-950/70 p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">项目保存与加载</h2>
            <button
              className="rounded-md bg-slate-800 px-2 py-1 text-slate-200 disabled:opacity-50"
              type="button"
              disabled={projectBusy !== null}
              onClick={() => void refreshProjects()}
            >
              {projectBusy === 'list' ? '刷新中…' : '刷新'}
            </button>
          </div>
          <input
            aria-label="项目名称"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
            value={projectName}
            maxLength={120}
            placeholder="项目名称"
            onChange={(event) => setProjectName(event.target.value)}
          />
          <button
            className="w-full rounded-lg bg-violet-600 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={!durableDocument || projectBusy !== null}
            onClick={() => void handleProjectSave()}
          >
            {projectBusy === 'save' ? '保存中…' : currentProject ? `保存项目（r${currentProject.revision}）` : '创建项目'}
          </button>
          {projectMessage && <p className="leading-5 text-slate-300">{projectMessage}</p>}
          <ul className="max-h-44 space-y-2 overflow-y-auto" aria-label="已保存项目">
            {projects.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900 p-2">
                <span className="min-w-0 truncate text-slate-200">{item.name} <span className="text-slate-500">r{item.revision}</span></span>
                <button
                  className="shrink-0 rounded-md bg-sky-700 px-2 py-1 text-white disabled:opacity-50"
                  type="button"
                  disabled={projectBusy !== null}
                  onClick={() => void handleLoadProject(item.id)}
                >
                  {projectBusy === 'load' ? '加载中…' : '加载'}
                </button>
              </li>
            ))}
            {projects.length === 0 && <li className="text-slate-500">暂无已保存项目</li>}
          </ul>
        </section>

        <section className="space-y-2 rounded-xl bg-slate-950/70 p-3 text-xs">
          <h2 className="text-slate-400">导出</h2>
          <div className="grid grid-cols-2 gap-2">
            <button
              aria-label="导出2D平面图PNG"
              className="rounded-lg bg-emerald-600 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={!canExport2D}
              onClick={handleExport2D}
            >
              {exportingScope === '2d' ? '导出中…' : '导出2D PNG'}
            </button>
            <button
              aria-label="导出3D白模PNG"
              className="rounded-lg bg-sky-600 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={!canExport3D}
              onClick={handleExport3D}
              title={webGLAvailable ? undefined : 'WebGL 不可用，无法导出 3D'}
            >
              {exportingScope === '3d' ? '导出中…' : webGLAvailable ? '导出3D PNG' : 'WebGL 不可用'}
            </button>
          </div>
          <p className="text-slate-500 leading-5">
            {canExportModel ? '基于当前编辑后的墙体、门窗 marker 与当前视口/镜头生成。' : '请先完成解析后再导出。'}
          </p>
        </section>

        <section className="mt-4 space-y-2 text-xs">
          <div className="rounded-xl bg-slate-950/70 p-3">
            <p className="text-slate-500 mb-2">历史与历史同步</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                aria-label="撤销（Ctrl/Cmd + Z）"
                className="rounded-lg bg-slate-800 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!canUndo(wallEditor)}
                onClick={handleUndo}
              >
                Undo
              </button>
              <button
                aria-label="重做（Ctrl/Cmd + Shift+Z 或 Ctrl/Cmd + Y）"
                className="rounded-lg bg-slate-800 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                disabled={!canRedo(wallEditor)}
                onClick={handleRedo}
              >
                Redo
              </button>
            </div>
            <p className="mt-2 text-slate-500">快捷键：Ctrl/Cmd + Z（Undo），Ctrl/Cmd + Shift+Z / Ctrl/Cmd + Y（Redo）</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-slate-950/70 p-3">
              <p className="text-slate-500">Rooms</p>
              <p className="mt-1 text-xl font-semibold">{editableResult?.rooms.length ?? 0}</p>
            </div>
            <div className="rounded-xl bg-slate-950/70 p-3">
              <p className="text-slate-500">Walls</p>
              <p className="mt-1 text-xl font-semibold">{walls.length}</p>
            </div>
          </div>
        </section>

        {editableResult && (
          <section className="mt-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold">解析摘要</h2>
              <div className="mt-2 space-y-2">
                {editableResult.rooms.slice(0, 6).map((room) => (
                  <div key={`${room.name}-${room.type}`} className="rounded-lg bg-slate-950/70 px-3 py-2 text-xs">
                    <span className="font-medium text-slate-200">{room.name}</span>
                    <span className="ml-2 text-slate-500">{room.type}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-sm font-semibold">结构化 JSON</h2>
              <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-black/60 p-3 text-[11px] leading-5 text-slate-300">
                {JSON.stringify(editableResult, null, 2)}
              </pre>
            </div>
          </section>
        )}
      </aside>

      <div className="absolute bottom-4 left-[410px] right-4 top-20 grid grid-cols-[minmax(0,3fr)_minmax(280px,2fr)] gap-3">
      <section
        className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl"
        aria-label="2D 墙体编辑器"
      >
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
          <span>2D 墙体端点校正（原图叠加）</span>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-slate-300">
              <input
                type="checkbox"
                checked={showSourceImage}
                onChange={(event) => setShowSourceImage(event.target.checked)}
              />
              显示底图
            </label>
            <span>
              {draggedEndpoint
                ? '拖拽中'
                : selectedWallIndex !== null
                  ? `已选择墙体 ${selectedWallIndex + 1}`
                  : hoveredEndpoint
                    ? '可拖拽端点（鼠标悬停）'
                    : '选择墙体或拖拽端点'}
            </span>
          </div>
        </div>

        <div className="h-[calc(100%-32px)] overflow-hidden rounded-xl border border-white/10 bg-black/70">
          <svg
            ref={editorRef}
            className="h-full w-full touch-none"
            viewBox={`${viewport.minX} ${viewport.minY} ${viewport.width} ${viewport.height}`}
            role="img"
            aria-label="户型图墙体端点编辑区"
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerCancel}
            onPointerLeave={handleCanvasPointerCancel}
            preserveAspectRatio="xMinYMin meet"
          >
            <rect
              x={viewport.minX}
              y={viewport.minY}
              width={viewport.width}
              height={viewport.height}
              fill="#0f172a"
            />

            {showSourceImage && previewURL && (
              <image
                href={previewURL}
                x={viewport.minX}
                y={viewport.minY}
                width={viewport.width}
                height={viewport.height}
                preserveAspectRatio="xMinYMin meet"
                opacity="0.42"
                pointerEvents="none"
              />
            )}

            {result &&
              [...result.doors, ...result.windows].map((opening, index) => {
                if (!isFiniteCoordinate(opening.x) || !isFiniteCoordinate(opening.y)) {
                  return null
                }
                const label = openingLabel(opening)
                return (
                  <g key={`${opening.type ?? 'opening'}-${index}`} pointerEvents="none">
                    <circle
                      cx={opening.x}
                      cy={opening.y}
                      r={openingRadius}
                      fill="none"
                      stroke="#f97316"
                      strokeWidth={openingStroke}
                    />
                    {label && (
                      <text
                        x={opening.x + labelOffset}
                        y={opening.y - labelOffset}
                        fill="#fbbf24"
                        fontSize={labelSize}
                      >
                        {label}
                      </text>
                    )}
                  </g>
                )
              })}

            <g aria-label="墙体可视层" pointerEvents="none">
              {walls.map((wall, wallIndex) => {
                const endpointActive =
                  hoveredEndpoint?.wallIndex === wallIndex || draggedEndpoint?.wallIndex === wallIndex
                const selected = selectedWallIndex === wallIndex
                const active = endpointActive || selected
                const color = draggedEndpoint?.wallIndex === wallIndex
                  ? '#22d3ee'
                  : selected
                    ? '#fbbf24'
                    : endpointActive
                      ? '#38bdf8'
                      : '#e2e8f0'

                return (
                  <line
                    key={`${wall.x1}-${wall.y1}-${wall.x2}-${wall.y2}-${wallIndex}`}
                    x1={wall.x1}
                    y1={wall.y1}
                    x2={wall.x2}
                    y2={wall.y2}
                    stroke={color}
                    strokeWidth={active ? activeWallStroke : wallStroke}
                  />
                )
              })}
            </g>

            <g aria-label="墙体透明命中层" fill="none" stroke="transparent" strokeLinecap="round">
              {walls.map((wall, wallIndex) => (
                <line
                  key={`hit-${wallIndex}`}
                  x1={wall.x1}
                  y1={wall.y1}
                  x2={wall.x2}
                  y2={wall.y2}
                  strokeWidth={wallHitStroke}
                  onPointerDown={(event) => handleWallPointerDown(event, wallIndex)}
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </g>

            <g aria-label="端点可视层" pointerEvents="none">
              {walls.flatMap((wall, wallIndex) => {
                const startSelected =
                  (hoveredEndpoint?.wallIndex === wallIndex && hoveredEndpoint.endpoint === 'start') ||
                  (draggedEndpoint?.wallIndex === wallIndex && draggedEndpoint.endpoint === 'start')
                const endSelected =
                  (hoveredEndpoint?.wallIndex === wallIndex && hoveredEndpoint.endpoint === 'end') ||
                  (draggedEndpoint?.wallIndex === wallIndex && draggedEndpoint.endpoint === 'end')
                return [
                  { endpoint: 'start' as const, x: wall.x1, y: wall.y1, selected: startSelected },
                  { endpoint: 'end' as const, x: wall.x2, y: wall.y2, selected: endSelected },
                ].map((handle) => (
                  <circle
                    key={`visible-${wallIndex}-${handle.endpoint}`}
                    cx={handle.x}
                    cy={handle.y}
                    r={handle.selected ? activeHandleRadius : handleRadius}
                    fill={handle.selected ? '#f8fafc' : '#38bdf8'}
                    stroke={handle.selected ? '#0f172a' : '#7dd3fc'}
                    strokeWidth={openingStroke}
                  />
                ))
              })}
            </g>

            <g aria-label="端点透明命中层" fill="transparent" stroke="transparent">
              {walls.flatMap((wall, wallIndex) =>
                [
                  { endpoint: 'start' as const, x: wall.x1, y: wall.y1 },
                  { endpoint: 'end' as const, x: wall.x2, y: wall.y2 },
                ].map((handle) => (
                  <circle
                    key={`hit-${wallIndex}-${handle.endpoint}`}
                    data-testid={`endpoint-handle-${wallIndex}-${handle.endpoint}`}
                    cx={handle.x}
                    cy={handle.y}
                    r={hitRadius}
                    onPointerDown={(event) =>
                      handleCanvasPointerDown(event, {
                        wallIndex,
                        endpoint: handle.endpoint,
                      })
                    }
                    style={{ cursor: 'grab' }}
                  />
                )),
              )}
            </g>
          </svg>
        </div>
      </section>

      <main
        className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl"
        aria-label="3D 户型预览"
      >
        <div className="absolute left-3 top-3 z-10 rounded-xl bg-black/60 px-3 py-2 text-xs text-white/75">
          <div className="font-medium text-white/90">3D 墙体 WASM Marching Cubes</div>
          <div className="mt-1 flex gap-3 text-[11px] text-white/60" aria-label="3D 白模实时指标">
            <span data-testid="wasm-engine-state">引擎 {wasmState}</span>
            <span data-testid="wasm-grid">Grid {wasmMetrics ? wasmMetrics.grid.join('×') : '—'}</span>
            <span data-testid="wasm-triangles">三角 {wasmMetrics?.triangleCount ?? 0}</span>
            <span>墙体 {wallShellModel.walls.length}</span>
          </div>
          <div className="mt-1 text-[11px] text-white/60" data-testid="wasm-resource-metrics">
            {wasmMetrics
              ? `顶点 ${wasmMetrics.vertexCount} · ${wasmMetrics.elapsedMs.toFixed(1)}ms · 输入 ${wasmMetrics.inputBytes}B · 输出 ${wasmMetrics.outputBytes}B`
              : wasmFallback
                ? `fallback: ${wasmFallback} · wall-shell ${wallShellTotalLength.toFixed(2)}`
                : '正在准备受控 17³ 标量场'}
          </div>
        </div>
        <div className="h-full w-full">
          {webGLAvailable ? (
            <Canvas
              camera={{ position: [8, 7, 8], fov: 50 }}
              shadows
              gl={{ antialias: true, preserveDrawingBuffer: true }}
              onCreated={(state) => {
                setThreeRenderer(state)
              }}
            >
              <Suspense fallback={null}>
                <Scene model={wallShellModel} wasmGeometry={wasmGeometry} wasmActive={wasmState === 'active'} />
                <OrbitControls makeDefault />
              </Suspense>
            </Canvas>
          ) : (
            <div
              className="flex h-full w-full items-center justify-center px-8 text-center"
              role="status"
              aria-label="3D 渲染不可用"
            >
              <div className="max-w-sm rounded-2xl border border-amber-400/25 bg-amber-950/30 px-5 py-4 text-sm leading-6 text-amber-100">
                当前浏览器未提供 WebGL，无法显示 3D 墙体白模。请在启用 WebGL 的浏览器中打开；2D 编辑和白模几何指标仍可使用。
              </div>
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-xl bg-black/55 px-3 py-2 text-center text-xs text-white/50">
          WASM 网格实时跟随当前墙段；失败时互斥回退至 wall-shell。橙色/蓝色仅为门窗 marker，尚未进行布尔开洞
        </div>
      </main>
      </div>
    </div>
  )
}
