import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
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

const API_PARSE_URL = '/api/floorplans/parse'

function roomColor(type: string) {
  if (type.includes('卧')) return '#60a5fa'
  if (type.includes('客')) return '#34d399'
  if (type.includes('厨')) return '#f59e0b'
  if (type.includes('卫')) return '#a78bfa'
  return '#94a3b8'
}

type Bounds = {
  x1: number
  y1: number
  x2: number
  y2: number
}

type Room = {
  name: string
  type: string
  approximate_bounds: Bounds
  area_ratio?: number
}

type ParsedOpening = {
  type?: string
  x?: number
  y?: number
  from?: string
  to?: string
}

type ParseResult = {
  rooms: Room[]
  walls: WallSegment[]
  doors: ParsedOpening[]
  windows: ParsedOpening[]
  scale: { unit: string; pixel_to_unit?: number }
  metadata: { source: string; confidence?: number; image_width?: number; image_height?: number }
}

type ParseResponse = {
  filename: string
  contentType: string
  size: number
  result: ParseResult
}

type ParseState = 'idle' | 'uploading' | 'ready' | 'error'

type ScenePoint = {
  x: number
  y: number
}

type Viewport = {
  minX: number
  minY: number
  width: number
  height: number
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
  result?: ParseResult
}

function Scene({ result }: FloorplanSceneProps) {
  const rooms = result?.rooms ?? []
  const model = useMemo(() => {
    if (rooms.length === 0) return []
    const minX = Math.min(...rooms.map((room) => room.approximate_bounds.x1))
    const maxX = Math.max(...rooms.map((room) => room.approximate_bounds.x2))
    const minY = Math.min(...rooms.map((room) => room.approximate_bounds.y1))
    const maxY = Math.max(...rooms.map((room) => room.approximate_bounds.y2))
    const span = Math.max(maxX - minX, maxY - minY, 1)
    const scale = 10 / span

    return rooms.map((room) => {
      const bounds = room.approximate_bounds
      const width = Math.max((bounds.x2 - bounds.x1) * scale, 0.12)
      const depth = Math.max((bounds.y2 - bounds.y1) * scale, 0.12)
      const x = (bounds.x1 + bounds.x2 - minX - maxX) * scale * 0.5
      const z = (bounds.y1 + bounds.y2 - minY - maxY) * scale * 0.5
      const height = room.type.includes('走廊') ? 0.22 : 0.42
      return { ...room, width, depth, x, z, height }
    })
  }, [rooms])

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[10, 15, 10]} intensity={0.85} castShadow />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial color="#172033" />
      </mesh>

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

      {model.length === 0 ? (
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[1.8, 0.9, 1.8]} />
          <meshStandardMaterial color="#4a90d9" wireframe />
        </mesh>
      ) : (
        model.map((room) => (
          <mesh key={`${room.name}-${room.x}-${room.z}`} position={[room.x, room.height / 2, room.z]} castShadow>
            <boxGeometry args={[room.width, room.height, room.depth]} />
            <meshStandardMaterial color={roomColor(room.type)} transparent opacity={0.72} />
          </mesh>
        ))
      )}
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
  if (rect.width === 0 || rect.height === 0) {
    return { x: Number.NaN, y: Number.NaN }
  }

  return {
    x: viewport.minX + ((event.clientX - rect.left) / rect.width) * viewport.width,
    y: viewport.minY + ((event.clientY - rect.top) / rect.height) * viewport.height,
  }
}

function hasFiniteCoordinate(point: ScenePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewURL, setPreviewURL] = useState<string>('')
  const [parseResponse, setParseResponse] = useState<ParseResponse | null>(null)
  const [status, setStatus] = useState<ParseState>('idle')
  const [error, setError] = useState<string>('')
  const [wallEditor, setWallEditor] = useState<WallEditorState | null>(null)
  const [hoveredEndpoint, setHoveredEndpoint] = useState<EndpointRef | null>(null)
  const [draggedEndpoint, setDraggedEndpoint] = useState<EndpointRef | null>(null)
  const [dragPreviewWalls, setDragPreviewWalls] = useState<WallSegment[] | null>(null)
  const [imageDimFallback, setImageDimFallback] = useState<{ width: number; height: number } | null>(null)

  const editorRef = useRef<SVGSVGElement | null>(null)
  const svgUrlRef = useRef('')

  const result = parseResponse?.result ?? null
  const walls = dragPreviewWalls ?? wallEditor?.walls ?? result?.walls ?? []

  const editableResult = useMemo<ParseResult | null>(() => {
    if (!parseResponse) return null
    return {
      ...parseResponse.result,
      walls,
    }
  }, [parseResponse, walls])

  const viewport = chooseViewport(result, imageDimFallback)

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

    setStatus('uploading')
    setError('')
    const formData = new FormData()
    formData.append('floorplan', selectedFile)

    try {
      const response = await fetch(API_PARSE_URL, {
        method: 'POST',
        body: formData,
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error ?? `解析失败：HTTP ${response.status}`)
      }
      setParseResponse(body as ParseResponse)
      setStatus('ready')
      setDraggedEndpoint(null)
      setDragPreviewWalls(null)
      setHoveredEndpoint(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
      setStatus('error')
    }
  }

  function handleFileChange(file: File | null) {
    setSelectedFile(file)
    setParseResponse(null)
    setWallEditor(null)
    setDragPreviewWalls(null)
    setHoveredEndpoint(null)
    setDraggedEndpoint(null)
    setError('')
    setStatus('idle')
    if (svgUrlRef.current) {
      setImageDimFallback(null)
    }

    if (previewURL) {
      URL.revokeObjectURL(previewURL)
    }
    setPreviewURL(file ? URL.createObjectURL(file) : '')
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
      return
    }

    if (draggedEndpoint) {
      const moveResult = moveEndpoint(wallEditor, draggedEndpoint, cursor)
      if (moveResult.changed) {
        setDragPreviewWalls(moveResult.walls)
      }
      return
    }

    const hit = pickEndpoint(walls, cursor, 12)
    setHoveredEndpoint(hit)
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
    commitDrag(event.pointerId)
  }

  return (
    <div className="w-full h-full bg-slate-950 text-slate-100">
      <div className="absolute top-0 left-0 right-0 z-10 bg-black/50 backdrop-blur-sm px-5 py-3 flex items-center justify-between border-b border-white/10">
        <span className="text-sm font-medium text-white/85">筑居 HomeVox — 2D 墙体闭环编辑（Issue #5）</span>
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
          </div>
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

      <div className="absolute left-[410px] top-20 bottom-4 right-4 rounded-2xl border border-white/10 bg-slate-950/60 p-2">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
          <span>2D 墙体端点校正（原图叠加）</span>
          <span>
            {draggedEndpoint
              ? '拖拽中'
              : hoveredEndpoint
                ? '可拖拽端点（鼠标悬停）'
                : '点击端点进行拖拽'}
          </span>
        </div>

        <div className="h-[calc(100%-32px)] rounded-xl bg-black/70 border border-white/10 overflow-hidden">
          <svg
            ref={editorRef}
            className="w-full h-full touch-none"
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

            {previewURL && (
              <image
                href={previewURL}
                x={viewport.minX}
                y={viewport.minY}
                width={viewport.width}
                height={viewport.height}
                preserveAspectRatio="xMidYMid meet"
                opacity="0.42"
              />
            )}

            {result &&
              [...result.doors, ...result.windows].map((opening, index) => {
                if (!isFiniteCoordinate(opening.x) || !isFiniteCoordinate(opening.y)) {
                  return null
                }
                return (
                  <g key={`${opening.type ?? 'opening'}-${index}`}>
                    <circle cx={opening.x} cy={opening.y} r={7} fill="none" stroke="#f97316" strokeWidth={2} />
                    <text x={opening.x + 10} y={opening.y - 10} fill="#fbbf24" fontSize={10}>
                      {opening.type ?? opening.from ?? 'open'}
                    </text>
                  </g>
                )
              })}

            {walls.map((wall, wallIndex) => {
              const active = hoveredEndpoint?.wallIndex === wallIndex || draggedEndpoint?.wallIndex === wallIndex
              const width = active ? 3 : 2
              const color = draggedEndpoint?.wallIndex === wallIndex
                ? '#22d3ee'
                : hoveredEndpoint?.wallIndex === wallIndex
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
                  strokeWidth={width}
                />
              )
            })}

            {walls.flatMap((wall, wallIndex) => {
              const startSelected =
                hoveredEndpoint?.wallIndex === wallIndex && hoveredEndpoint?.endpoint === 'start'
                  ? true
                  : draggedEndpoint?.wallIndex === wallIndex && draggedEndpoint?.endpoint === 'start'
                    ? true
                    : false
              const endSelected =
                hoveredEndpoint?.wallIndex === wallIndex && hoveredEndpoint?.endpoint === 'end'
                  ? true
                  : draggedEndpoint?.wallIndex === wallIndex && draggedEndpoint?.endpoint === 'end'
                    ? true
                    : false
              return [
                {
                  endpoint: 'start' as const,
                  x: wall.x1,
                  y: wall.y1,
                  selected: startSelected,
                },
                {
                  endpoint: 'end' as const,
                  x: wall.x2,
                  y: wall.y2,
                  selected: endSelected,
                },
              ].map((handle) => (
                <circle
                  key={`${wallIndex}-${handle.endpoint}`}
                  cx={handle.x}
                  cy={handle.y}
                  r={handle.selected ? 6 : 4}
                  fill={handle.selected ? '#f8fafc' : '#38bdf8'}
                  stroke={handle.selected ? '#0f172a' : '#7dd3fc'}
                  strokeWidth={handle.selected ? 2 : 1}
                  onPointerDown={(event) =>
                    handleCanvasPointerDown(event, {
                      wallIndex,
                      endpoint: handle.endpoint,
                    })
                  }
                  style={{ cursor: 'grab' }}
                />
              ))
            })}
          </svg>
        </div>
      </div>

      <main className="h-full pl-[420px]">
        <Canvas camera={{ position: [8, 7, 8], fov: 50 }} shadows gl={{ antialias: true }}>
          <Suspense fallback={null}>
            <Scene result={editableResult ?? undefined} />
            <OrbitControls makeDefault />
          </Suspense>
        </Canvas>
      </main>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-4 py-2 text-xs text-white/45">
        3D 白模入口：解析后继续以 room bounds 渲染，仅作为预览；墙体编辑不影响真实几何构建
      </div>
    </div>
  )
}
