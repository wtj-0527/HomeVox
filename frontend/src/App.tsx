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
  type ProjectDetail,
} from './projects'
import { canApplyProductFlowEvent, initialCompletedSteps, type ProductStep, type ProductFlowContext } from './productFlow'
import { ProductShell } from './ProductShell'
import type { FloorplanEditorPanelProps } from './FloorplanEditorPanel'
import type { InspectorPanelProps } from './InspectorPanel'
import { ProjectSaveView } from './ProjectSaveView'
import { LinkedWorkspace, ThreeDConfirmation, TwoDWorkspace } from './ProductViews'
import { SourceImportView, AIParseView, type ParseViewStatus } from './SourceImportView'
import type { ThreeDPreviewPanelProps } from './ThreeDPreviewPanel'
import type { ThreeDRenderer } from './ThreeDPreview'
import { useProductFlowController } from './useProductFlowController'
import { useProjectSession } from './useProjectSession'
import { useThreeDGenerationController } from './useThreeDGenerationController'
import { canExportCurrentThreeD } from './threeDExport'
import { exportCurrentThreeDRevision, type ThreeDExportRevision } from './threeDExportSession'
import { canonicalRevisionToken } from './floorplanSession'
import { e2EProjectID, e2EWasmLoader, isE2EInstrumentationEnabled, publishE2EState } from '@homevox-e2e'
import './App.css'

const API_PARSE_URL = '/api/floorplans/parse'
const EMPTY_WALLS: WallSegment[] = []


type ParseState = ParseViewStatus

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
  const initialProjectLoadRef = useRef<(id: string) => Promise<void>>(() => Promise.resolve())
  const wasmGenerationRef = useRef(0)
  const [, setWasmGeneration] = useState(0)
  const wasmGeometryRef = useRef<BufferGeometry | null>(null)
  const wasmCallsRef = useRef(0)
  const threeDExportRevisionRef = useRef<ThreeDExportRevision<ThreeDRenderer>>({
    canonicalRevision: null,
    geometryRevision: null,
    rendererRevision: null,
    frameRevision: null,
    renderer: null,
  })

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
    frameRevision,
    isCurrent: isCurrentThreeDGeneration,
    invalidateGeometry,
    resolveGeometry,
    mountRenderer,
    unmountRenderer,
    acknowledgeFrame,
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
  const applyLoadedProject = useCallback((loaded: ProjectDetail, sourceImage: Blob) => {
    const nextPreviewURL = URL.createObjectURL(sourceImage)
    setPreviewURL((currentURL) => {
      if (currentURL) URL.revokeObjectURL(currentURL)
      return nextPreviewURL
    })
    setSelectedFile(null)
    setParseResponse(loaded.document)
    applyProductTransition(
      { type: 'reload', completed: initialCompletedSteps({ hasCanonicalDocument: true, isSavedProject: true }) },
      { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false },
    )
    applyProductTransition(
      { type: 'open', step: 3 },
      { hasDocument: true, hasCanonicalGeometry: true, hasThreeDGeometry: false },
    )
    setStatus('ready')
    setDraggedEndpoint(null)
    setDragPreviewWalls(null)
    setHoveredEndpoint(null)
    setSelectedWallID(null)
    setSelectedOpeningID(null)
    setDraggedOpeningID(null)
    setDragPreviewOpenings(null)
    setOpeningError('')
  }, [applyProductTransition])
  const projectSession = useProjectSession({
    document: durableDocument,
    geometryValidationError,
    sourceFile: selectedFile,
    onProjectSaved: () => applyProductTransition({ type: 'complete', step: 6 }, productFlowContext),
    onProjectLoaded: applyLoadedProject,
  })
  const {
    projectName,
    currentProject,
    projects,
    projectMessage,
    projectBusy,
    setProjectName,
    clearCurrentProject,
    refreshProjects,
    saveProject,
    loadProject,
  } = projectSession
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
    frameGeneration: frameRevision,
    canonicalGeneration: canonicalRevision,
  })
  // This ref is updated during every render instead of in an effect so an
  // event that starts a toBlob export always compares against the latest
  // canonical/WASM/renderer/frame identity after any legal edit.
  threeDExportRevisionRef.current = {
    canonicalRevision,
    geometryRevision,
    rendererRevision: threeRenderer?.generation ?? null,
    frameRevision,
    renderer: threeRenderer,
  }

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
      threeD: {
        canonicalRevision,
        geometryRevision,
        rendererRevision: threeRenderer?.generation ?? null,
        frameRevision,
        currentFrame: currentThreeDGeneration,
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
  }, [canonicalRevision, currentProject, currentThreeDGeneration, frameRevision, geometryRevision, openings, selectedOpeningID, threeRenderer, walls, wasmGeometry, wasmMetrics, wasmState])

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
  }, [refreshProjects])

  // The URL-selected project is an initial-load command, not a reactive
  // request; later editor changes must never reload it over local edits.
  initialProjectLoadRef.current = loadProject
  useEffect(() => {
    const projectID = e2EProjectID()
    if (projectID) void initialProjectLoadRef.current(projectID)
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

    applyProductTransition({ type: 'complete', step: 1, next: 2 }, { hasDocument: false, hasCanonicalGeometry: false, hasThreeDGeometry: false })
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
      clearCurrentProject()
      setProjectName(projectName || body.filename)
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
    clearCurrentProject()
    applyProductTransition({ type: 'reload', completed: file ? [1] : [] }, { hasDocument: false, hasCanonicalGeometry: false, hasThreeDGeometry: false })

    setPreviewURL((currentURL) => {
      if (currentURL) URL.revokeObjectURL(currentURL)
      return file ? URL.createObjectURL(file) : ''
    })
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
    const revision = threeDExportRevisionRef.current
    const renderer = revision.renderer
    if (!canExport3D || !renderer) {
      return
    }

    setExportingScope('3d')
    setExportError('')

    try {
      const fileName = buildScopeFileName('3d')
      const result = await exportCurrentThreeDRevision({
        revision,
        readCurrent: () => threeDExportRevisionRef.current,
        render: () => {
          const rendererState = renderer.state
          rendererState.gl.render(rendererState.scene, rendererState.camera)
        },
        exportPng: () => exportWebGLCanvasToPng(renderer.state.gl, fileName),
        download: downloadBlobAsPng,
        onStale: () => setExportError('模型已更新，请重新导出。'),
      })
      if (result.status === 'failure') {
        setExportError(result.error.message)
        return
      }
    } catch (error) {
      setExportError(`3D 导出失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setExportingScope(null)
    }
  }

  const editorProps: FloorplanEditorPanelProps = {
    editorRef,
    viewport,
    walls,
    openings,
    showSourceImage,
    previewURL,
    geometryValidationError,
    selectedWallID,
    selectedWallLabel: selectedWall?.id ?? null,
    selectedOpeningID,
    hoveredEndpoint,
    draggedEndpoint,
    hitRadius,
    handleRadius,
    activeHandleRadius,
    wallHitStroke,
    wallStroke,
    activeWallStroke,
    openingRadius,
    openingStroke,
    labelOffset,
    labelSize,
    onShowSourceImageChange: setShowSourceImage,
    onCanvasPointerMove: handleCanvasPointerMove,
    onCanvasPointerUp: handleCanvasPointerUp,
    onCanvasPointerCancel: handleCanvasPointerCancel,
    onEndpointPointerDown: handleCanvasPointerDown,
    onWallPointerDown: handleWallPointerDown,
    onOpeningPointerDown: handleOpeningPointerDown,
  }
  const inspectorProps: InspectorPanelProps = {
    selectedWallID,
    selectedOpening,
    openingError,
    canExport2D,
    canExport3D,
    exportingScope,
    exportError,
    canUndo: canUndo(wallEditor),
    canRedo: canRedo(wallEditor),
    onAddOpening: handleAddOpening,
    onOpeningWidthChange: (width) => {
      if (selectedOpening?.id) commitOpeningPatch(selectedOpening.id, { width })
    },
    onDeleteOpening: handleDeleteOpening,
    onExport2D: () => { void handleExport2D() },
    onExport3D: () => { void handleExport3D() },
    onUndo: handleUndo,
    onRedo: handleRedo,
  }
  const threeDPreviewProps: ThreeDPreviewPanelProps = {
    canonicalRevision,
    model: wallShellModel,
    wasmGeometry,
    wasmActive: wasmState === 'active',
    webGLAvailable,
    selectedWallID,
    selectedOpeningID,
    onSelectWall: selectWall,
    onSelectOpening: selectOpening,
    onRendererMount: mountRenderer,
    onRendererUnmount: unmountRenderer,
    onFrameRendered: acknowledgeFrame,
    geometryValidationError,
  }

  const completeAndAdvance = (step: ProductStep, next: ProductStep) => applyProductTransition({ type: 'complete', step, next })

  const goNext = () => {
    if (activeStep === 3) completeAndAdvance(3, 4)
    else if (activeStep === 5) completeAndAdvance(5, 6)
  }

  const flow: ProductFlowContext = { completed: completedSteps, ...productFlowContext }
  const pendingCompletion = activeStep === 3 || activeStep === 5
    ? { type: 'complete' as const, step: activeStep, next: (activeStep + 1) as ProductStep }
    : null
  const canAdvance = Boolean(pendingCompletion && canApplyProductFlowEvent(
    { activeStep, completed: completedSteps },
    pendingCompletion,
    productFlowContext,
  ))
  const primaryAction = undefined

  return (
    <ProductShell activeStep={activeStep} completedSteps={completedSteps} flow={flow} hasDocument={Boolean(durableDocument)} onOpenStep={(step) => applyProductTransition({ type: 'open', step })} primaryAction={primaryAction}>
        {activeStep === 1 && <SourceImportView selectedFile={selectedFile} previewURL={previewURL} onFileChange={handleFileChange} status={status} error={error} onParse={handleParse} />}
        {activeStep === 2 && <AIParseView selectedFile={selectedFile} previewURL={previewURL} onFileChange={handleFileChange} status={status} error={error} onParse={handleParse} />}
        {activeStep === 3 && <TwoDWorkspace editor={editorProps} inspector={inspectorProps} canAdvance={canAdvance} onAdvance={goNext} />}
        {activeStep === 4 && <ThreeDConfirmation preview={threeDPreviewProps} previewAvailable={canRenderThreeDPreview} canOpenLinkedWorkspace={canOpenLinkedWorkspace} wasmState={wasmState} onBack={() => applyProductTransition({ type: 'open', step: 3 })} onComplete={() => completeAndAdvance(4, 5)} />}
        {activeStep === 5 && <LinkedWorkspace editor={editorProps} preview={threeDPreviewProps} inspector={inspectorProps} previewAvailable={canRenderThreeDPreview} canAdvance={canAdvance} onAdvance={goNext} onBack={() => applyProductTransition({ type: 'open', step: 3 })} />}
        {activeStep === 6 && <ProjectSaveView projectName={projectName} currentProject={currentProject} projects={projects} projectMessage={projectMessage} projectBusy={projectBusy} canSave={hasCanonicalGeometry} onProjectNameChange={setProjectName} onSave={() => { void saveProject() }} onRefresh={() => { void refreshProjects() }} onLoad={(id) => { void loadProject(id) }} />}
    </ProductShell>
  )
}
