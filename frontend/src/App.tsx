import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
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
  validateCanonicalFloorplan,
  MIN_OPENING_WIDTH,
  type ParsedOpening,
  type ParseResponse,
  type ParseResult,
  type Viewport,
} from './floorplanUi'
import { buildWallShellModel } from './wallShell'
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
import { canApplyProductFlowEvent, initialCompletedSteps, type ProductStep, type ProductFlowContext } from './productFlow'
import { ProductShell } from './ProductShell'
import { FloorplanEditorPanel } from './FloorplanEditorPanel'
import { LinkedWorkspace, ThreeDConfirmation, TwoDWorkspace } from './ProductViews'
import { ThreeDPreview } from './ThreeDPreview'
import { useProductFlowController } from './useProductFlowController'
import { useThreeDGenerationController } from './useThreeDGenerationController'
import { canExportCurrentThreeD } from './threeDExport'
import { canonicalRevisionToken } from './floorplanSession'
import { e2EProjectID, e2EWasmLoader, isE2EInstrumentationEnabled, publishE2EState } from '@homevox-e2e'
import './App.css'

const API_PARSE_URL = '/api/floorplans/parse'
const EMPTY_WALLS: WallSegment[] = []


type ParseState = 'idle' | 'uploading' | 'ready' | 'error'

type ScenePoint = {
  x: number
  y: number
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
    if (finiteNumber(b.x1) && finiteNumber(b.y1) && finiteNumber(b.x2) && finiteNumber(b.y2)) coords.push(b.x1, b.y1, b.x2, b.y2)
  }
  for (const wall of result.walls) {
    if (finiteNumber(wall.x1) && finiteNumber(wall.y1) && finiteNumber(wall.x2) && finiteNumber(wall.y2)) coords.push(wall.x1, wall.y1, wall.x2, wall.y2)
  }
  for (const opening of [...result.doors, ...result.windows]) {
    if (finiteNumber(opening.x) && finiteNumber(opening.y)) coords.push(opening.x, opening.y)
  }
  if (coords.length < 2) return null
  const xs = coords.filter((_, index) => index % 2 === 0)
  const ys = coords.filter((_, index) => index % 2 === 1)
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  const rawWidth = maxX - minX; const rawHeight = maxY - minY
  if (rawWidth <= 0 || rawHeight <= 0) return null
  const padding = Math.max(rawWidth, rawHeight) * 0.1
  return { minX: minX - padding, minY: minY - padding, width: rawWidth + padding * 2, height: rawHeight + padding * 2 }
}

function chooseViewport(result: ParseResult | null, fallbackImageSize: { width: number; height: number } | null): Viewport {
  const imageWidth = safeNumber(result?.metadata.image_width, Number.NaN)
  const imageHeight = safeNumber(result?.metadata.image_height, Number.NaN)
  if (isFinitePositiveInteger(imageWidth) && isFinitePositiveInteger(imageHeight)) return { minX: 0, minY: 0, width: imageWidth, height: imageHeight }
  if (fallbackImageSize && isFinitePositiveInteger(fallbackImageSize.width) && isFinitePositiveInteger(fallbackImageSize.height)) return { minX: 0, minY: 0, width: fallbackImageSize.width, height: fallbackImageSize.height }
  const inferred = collectViewportFromParse(result)
  return inferred ?? { minX: 0, minY: 0, width: 1024, height: 768 }
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
  const productFlow = useProductFlowController()
  const { activeStep, completed: completedSteps, transition: transitionProductFlow } = productFlow
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
  const initialProjectLoadRef = useRef<(id: string) => void>(() => undefined)
  const wasmGenerationRef = useRef(0)
  const [, setWasmGeneration] = useState(0)
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
    () => validateCanonicalFloorplan(walls, openings),
    [walls, openings],
  )
  const hasCanonicalGeometry = Boolean(durableDocument) && !geometryValidationError
  // Content token changes in the same render as every wall/opening commit, before
  // React effects get a chance to dispose stale WASM or WebGL resources.
  const canonicalRevision = useMemo(() => canonicalRevisionToken(walls, openings, hasCanonicalGeometry), [walls, openings, hasCanonicalGeometry])
  const threeDGeneration = useThreeDGenerationController(canonicalRevision)
  const {
    geometryRevision,
    renderer: threeRenderer,
    isCurrent: isCurrentThreeDGeneration,
    invalidateGeometry,
    resolveGeometry,
    mountRenderer,
    unmountRenderer,
  } = threeDGeneration
  const currentThreeDGeneration = isCurrentThreeDGeneration(wasmState === 'active' && wasmGeometry !== null)
  // Confirmation mounts the renderer that completes the revision handshake.
  // It may show only a current canonical/WASM pair; entering Step 5 additionally
  // requires the renderer token through currentThreeDGeneration.
  const canRenderThreeDPreview = hasCanonicalGeometry &&
    webGLAvailable &&
    wasmState === 'active' &&
    wasmGeometry !== null &&
    canonicalRevision !== null &&
    canonicalRevision === geometryRevision
  const canOpenLinkedWorkspace = hasCanonicalGeometry && webGLAvailable && currentThreeDGeneration
  const productFlowContext = useMemo(() => ({
    hasDocument: Boolean(durableDocument),
    hasCanonicalGeometry,
    hasThreeDGeometry: canOpenLinkedWorkspace,
  }), [canOpenLinkedWorkspace, durableDocument, hasCanonicalGeometry])
  const applyProductTransition = useCallback((event: Parameters<typeof productFlow.transition>[0], context = productFlowContext) => {
    transitionProductFlow(event, context)
  }, [productFlowContext, transitionProductFlow])
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
  const canExport3D = canExportCurrentThreeD({
    isExporting,
    hasModel: canExportModel,
    webGLAvailable,
    wasmActive: wasmState === 'active',
    hasWasmGeometry: wasmGeometry !== null,
    rendererMounted: threeRenderer !== null,
    rendererGeneration: threeRenderer?.generation ?? null,
    geometryGeneration: geometryRevision,
    canonicalGeneration: canonicalRevision,
  })

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
    publishE2EState({
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
    })
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
    const revision = canonicalRevision
    wasmGenerationRef.current = generation
    setWasmGeneration(generation)
    invalidateGeometry()
    const replaceGeometry = (next: BufferGeometry | null) => {
      disposeWasmWallGeometry(wasmGeometryRef.current)
      wasmGeometryRef.current = next
      setWasmGeometry(next)
    }

    if (!wallVoxelModel || !revision) {
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
        e2EWasmLoader(),
      )
      if (disposed || wasmGenerationRef.current !== generation || canonicalRevision !== revision) return
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
      if (disposed || wasmGenerationRef.current !== generation || canonicalRevision !== revision) {
        disposeWasmWallGeometry(nextGeometry)
        return
      }
      replaceGeometry(nextGeometry)
      setWasmMetrics(result.metrics)
      resolveGeometry(revision)
      setWasmState('active')
    })(wallVoxelModel)

    return () => {
      disposed = true
    }
  }, [canonicalRevision, geometryValidationError, invalidateGeometry, resolveGeometry, wallVoxelModel])

  useEffect(() => {
    void refreshProjects()
  }, [])

  // The URL-selected project is an initial-load command, not a reactive
  // request; later editor changes must never reload it over local edits.
  initialProjectLoadRef.current = handleLoadProject
  useEffect(() => {
    const projectID = e2EProjectID()
    if (projectID) initialProjectLoadRef.current(projectID)
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
      applyProductTransition({ type: 'complete', step: 2, next: 3 }, { hasDocument: true, hasCanonicalGeometry: false, hasThreeDGeometry: false })
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
    applyProductTransition({ type: 'reload', completed: file ? [1] : [] }, { hasDocument: false, hasCanonicalGeometry: false, hasThreeDGeometry: false })
    if (file) applyProductTransition({ type: 'open', step: 2 }, { hasDocument: false, hasCanonicalGeometry: false, hasThreeDGeometry: false })

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
    if (geometryValidationError) {
      setProjectMessage('当前户型几何无效，请返回 2D 校正后再保存')
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
      applyProductTransition({ type: 'complete', step: 6 }, productFlowContext)
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
      applyProductTransition({ type: 'reload', completed: initialCompletedSteps({ hasCanonicalDocument: true, isSavedProject: true }) }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false })
      applyProductTransition({ type: 'open', step: 3 }, { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false })
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
        ? validateCanonicalFloorplan(moveResult.walls, wallEditor.openings)
        : null
      setDragPreviewWalls(moveResult.changed ? moveResult.walls : null)
      setOpeningError(openingValidationError ?? '')
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
      const openingValidationError = validateCanonicalFloorplan(dragPreviewWalls, wallEditor.openings)
      setWallEditor(pushWallSnapshot(wallEditor, dragPreviewWalls, wallEditor.openings))
      setOpeningError(openingValidationError ?? '')
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
      const rendererState = threeRenderer.state
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
    <FloorplanEditorPanel
      editorRef={editorRef}
      viewport={viewport}
      walls={walls}
      openings={openings}
      showSourceImage={showSourceImage}
      previewURL={previewURL}
      geometryValidationError={geometryValidationError}
      selectedWallID={selectedWallID}
      selectedWallLabel={selectedWall?.id ?? null}
      selectedOpeningID={selectedOpeningID}
      hoveredEndpoint={hoveredEndpoint}
      draggedEndpoint={draggedEndpoint}
      hitRadius={hitRadius}
      handleRadius={handleRadius}
      activeHandleRadius={activeHandleRadius}
      wallHitStroke={wallHitStroke}
      wallStroke={wallStroke}
      activeWallStroke={activeWallStroke}
      openingRadius={openingRadius}
      openingStroke={openingStroke}
      labelOffset={labelOffset}
      labelSize={labelSize}
      onShowSourceImageChange={setShowSourceImage}
      onCanvasPointerMove={handleCanvasPointerMove}
      onCanvasPointerUp={handleCanvasPointerUp}
      onCanvasPointerCancel={handleCanvasPointerCancel}
      onEndpointPointerDown={handleCanvasPointerDown}
      onWallPointerDown={handleWallPointerDown}
      onOpeningPointerDown={handleOpeningPointerDown}
    />
  )

  const threeDPanel = (
    <main className="three-card relative min-h-[520px] min-w-0 overflow-hidden" aria-label="3D 户型预览">
      <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-xl bg-black/60 px-3 py-2 text-xs text-white/75">
        <div className="font-medium text-white/90">3D 空间 · 同源可编辑预览</div><p className="mt-1 inline-flex rounded-full bg-violet-500/25 px-2 py-0.5 text-[11px] font-medium text-violet-100">已生成可审阅的同源 3D 几何</p>
        <p className="mt-1 text-[11px] text-white/65">选择墙体、门窗可在两个视图中保持一致。</p>
        {geometryValidationError && <p className="mt-1 max-w-xs text-[11px] text-amber-200" role="alert">当前开口数据无法生成 3D，请返回 2D 校正后重试。</p>}
      </div>
      <div className="h-full w-full">
        <ThreeDPreview canonicalRevision={canonicalRevision} model={wallShellModel} wasmGeometry={wasmGeometry} wasmActive={wasmState === 'active'} webGLAvailable={webGLAvailable} selectedWallID={selectedWallID} selectedOpeningID={selectedOpeningID} onSelectWall={selectWall} onSelectOpening={selectOpening} onRendererMount={mountRenderer} onRendererUnmount={unmountRenderer} />
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
      <button type="button" className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => applyProductTransition({ type: 'open', step: 3 })}>返回 2D 校正</button>
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

  const sourcePreview = previewURL && selectedFile && (
    <section className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="已选择的户型图">
      <div className="flex items-start justify-between gap-3"><div><p className="font-medium text-slate-800">原图预览</p><p className="mt-1 text-xs text-slate-500">{selectedFile.name} · {selectedFile.type || '未知类型'} · {selectedFile.size.toLocaleString()} bytes</p></div><label className="cursor-pointer rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-medium text-violet-700">重新选择<input className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} /></label></div>
      <img className="mt-3 max-h-72 w-full rounded-lg object-contain bg-white" src={previewURL} alt="上传户型图预览" />
    </section>
  )

  const savePanel = (
    <section className="workspace-card mx-auto w-full max-w-2xl p-6 text-slate-800"><h3 className="text-xl font-semibold">保存项目</h3><p className="mt-2 text-sm text-slate-500">手动保存当前同源 2D 与 3D 数据。保存不可用时会保留当前编辑，不会假装成功。</p><div className="mt-6 space-y-3"><input aria-label="项目名称" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" value={projectName} maxLength={120} placeholder="项目名称" onChange={(event) => setProjectName(event.target.value)} /><button className="w-full rounded-lg bg-violet-600 px-3 py-2 font-medium text-white disabled:opacity-50" type="button" disabled={!hasCanonicalGeometry || projectBusy !== null} onClick={() => void handleProjectSave()}>{projectBusy === 'save' ? '保存中…' : currentProject ? `保存项目（r${currentProject.revision}）` : '创建项目'}</button>{projectMessage && <p role="status" className="text-sm text-slate-700">{projectMessage}</p>}<div className="border-t border-slate-200 pt-4"><div className="mb-2 flex items-center justify-between"><h4 className="font-semibold">已保存项目</h4><button className="rounded-md border border-slate-300 px-2 py-1 text-xs" type="button" disabled={projectBusy !== null} onClick={() => void refreshProjects()}>{projectBusy === 'list' ? '刷新中…' : '刷新'}</button></div><ul className="space-y-2" aria-label="已保存项目">{projects.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2"><span>{item.name} <span className="text-slate-500">r{item.revision}</span></span><button className="rounded-md bg-sky-700 px-2 py-1 text-xs text-white" type="button" disabled={projectBusy !== null} onClick={() => void handleLoadProject(item.id)}>加载</button></li>)}{projects.length === 0 && <li className="text-sm text-slate-500">暂无已保存项目</li>}</ul></div></div></section>
  )

  const completeAndAdvance = (step: ProductStep, next: ProductStep) => applyProductTransition({ type: 'complete', step, next })

  const goNext = () => {
    if (activeStep === 1 && selectedFile) completeAndAdvance(1, 2)
    else if (activeStep === 3) completeAndAdvance(3, 4)
    else if (activeStep === 5) completeAndAdvance(5, 6)
  }

  const flow: ProductFlowContext = { completed: completedSteps, ...productFlowContext }
  const pendingCompletion = activeStep === 1 || activeStep === 3 || activeStep === 5
    ? { type: 'complete' as const, step: activeStep, next: (activeStep + 1) as ProductStep }
    : null
  const canAdvance = Boolean(pendingCompletion && canApplyProductFlowEvent(
    { activeStep, completed: completedSteps },
    pendingCompletion,
    productFlowContext,
  ) && (activeStep !== 1 || selectedFile))
  const primaryAction = pendingCompletion && <button className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" type="button" disabled={!canAdvance} onClick={goNext}>{activeStep === 1 ? '继续到 AI 识别' : '继续'}</button>

  return (
    <ProductShell activeStep={activeStep} completedSteps={completedSteps} flow={flow} hasDocument={Boolean(durableDocument)} onOpenStep={(step) => applyProductTransition({ type: 'open', step })} primaryAction={primaryAction}>
        {activeStep === 1 && <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800"><h3 className="text-xl font-semibold">导入真实户型图</h3><p className="mt-2 text-sm text-slate-500">从你的图纸开始，不套用示意户型。</p><label className="mt-6 block cursor-pointer rounded-xl border border-dashed border-slate-400 bg-slate-50 p-5 text-sm hover:border-violet-500"><span className="block font-medium">选择户型图</span><span className="mt-1 block text-xs text-slate-500">支持 PNG、JPEG、GIF、WebP；后端限制 10 MiB</span><input className="mt-3 block w-full text-xs" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)} /></label>{sourcePreview}</section>}
        {activeStep === 2 && <section className="workspace-card mx-auto max-w-2xl p-6 text-slate-800"><h3 className="text-xl font-semibold">AI 识别</h3><p className="mt-2 text-sm text-slate-500">识别前请核对这张原图；识别完成后才会打开可校正的同源 2D 数据。</p>{sourcePreview}<button className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" type="button" disabled={status === 'uploading' || !selectedFile} onClick={handleParse}>{status === 'uploading' ? 'AI 识别中…' : '开始 AI 识别'}</button><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><span className="text-slate-500">识别状态：</span>{status === 'ready' ? '解析完成' : status === 'uploading' ? '解析中' : status === 'error' ? '失败' : '等待开始'}{error && <p role="alert" className="mt-2 text-red-700">{error}</p>}</div>{status === 'error' && selectedFile && <button type="button" className="mt-3 rounded-lg border border-violet-300 px-3 py-2 text-sm text-violet-700" onClick={handleParse}>重试 AI 识别</button>}</section>}
        {activeStep === 3 && <TwoDWorkspace editor={twoDPanel} inspector={editorInspector} />}
        {activeStep === 4 && <ThreeDConfirmation preview={threeDPanel} unavailable={threeDUnavailablePanel} previewAvailable={canRenderThreeDPreview} canOpenLinkedWorkspace={canOpenLinkedWorkspace} onBack={() => applyProductTransition({ type: 'open', step: 3 })} onComplete={() => completeAndAdvance(4, 5)} />}
        {activeStep === 5 && <LinkedWorkspace editor={twoDPanel} preview={threeDPanel} inspector={editorInspector} previewAvailable={canRenderThreeDPreview} onBack={() => applyProductTransition({ type: 'open', step: 3 })} />}
        {activeStep === 6 && savePanel}
    </ProductShell>
  )
}
