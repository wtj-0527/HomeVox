import { Canvas } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import { Suspense, useMemo, useState } from 'react'

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

type Segment = {
  x1: number
  y1: number
  x2: number
  y2: number
}

type ParseResult = {
  rooms: Room[]
  walls: Segment[]
  doors: unknown[]
  windows: unknown[]
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

function roomColor(type: string) {
  if (type.includes('卧')) return '#60a5fa'
  if (type.includes('客')) return '#34d399'
  if (type.includes('厨')) return '#f59e0b'
  if (type.includes('卫')) return '#a78bfa'
  return '#94a3b8'
}

function Scene({ result }: { result?: ParseResult }) {
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

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewURL, setPreviewURL] = useState<string>('')
  const [parseResponse, setParseResponse] = useState<ParseResponse | null>(null)
  const [status, setStatus] = useState<ParseState>('idle')
  const [error, setError] = useState<string>('')

  const result = parseResponse?.result

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
      const response = await fetch('/api/floorplans/parse', {
        method: 'POST',
        body: formData,
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error ?? `解析失败：HTTP ${response.status}`)
      }
      setParseResponse(body as ParseResponse)
      setStatus('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
      setStatus('error')
    }
  }

  function handleFileChange(file: File | null) {
    setSelectedFile(file)
    setParseResponse(null)
    setError('')
    setStatus('idle')
    if (previewURL) URL.revokeObjectURL(previewURL)
    setPreviewURL(file ? URL.createObjectURL(file) : '')
  }

  return (
    <div className="w-full h-full bg-slate-950 text-slate-100">
      <div className="absolute top-0 left-0 right-0 z-10 bg-black/50 backdrop-blur-sm px-5 py-3 flex items-center justify-between border-b border-white/10">
        <span className="text-sm font-medium text-white/85">筑居 HomeVox — MVP Core Pipeline</span>
        <span className="text-xs text-white/50">0.0.0.0:18088 API · React/R3F Viewport</span>
      </div>

      <aside className="absolute left-4 top-20 bottom-4 z-10 w-[380px] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/90 p-4 shadow-2xl backdrop-blur">
        <section className="space-y-3">
          <div>
            <h1 className="text-lg font-semibold">户型图上传与 AI 解析</h1>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              上传图片后由 Go API 接收与校验，再调用 OpenAI-compatible AI 解析为 rooms / walls / doors / windows / scale / metadata。
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
              <span className={status === 'error' ? 'text-red-300' : status === 'ready' ? 'text-emerald-300' : 'text-slate-200'}>
                {status === 'ready' ? '解析完成' : status === 'uploading' ? '解析中' : status === 'error' ? '失败' : '等待上传'}
              </span>
            </div>
            {error && <p className="mt-2 leading-5 text-red-300">{error}</p>}
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl bg-slate-950/70 p-3">
            <p className="text-slate-500">Rooms</p>
            <p className="mt-1 text-xl font-semibold">{result?.rooms.length ?? 0}</p>
          </div>
          <div className="rounded-xl bg-slate-950/70 p-3">
            <p className="text-slate-500">Walls</p>
            <p className="mt-1 text-xl font-semibold">{result?.walls.length ?? 0}</p>
          </div>
        </section>

        {result && (
          <section className="mt-4 space-y-3">
            <div>
              <h2 className="text-sm font-semibold">解析摘要</h2>
              <div className="mt-2 space-y-2">
                {result.rooms.slice(0, 6).map((room) => (
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
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </section>
        )}
      </aside>

      <main className="h-full pl-[420px]">
        <Canvas camera={{ position: [8, 7, 8], fov: 50 }} shadows gl={{ antialias: true }}>
          <Suspense fallback={null}>
            <Scene result={result} />
            <OrbitControls makeDefault />
          </Suspense>
        </Canvas>
      </main>

      <div className="absolute bottom-4 left-[calc(420px+50%)] -translate-x-1/2 rounded-full bg-black/40 px-4 py-2 text-xs text-white/45">
        3D 白模入口：解析完成后按房间 bounds 生成基础体块 · 拖拽旋转 · 滚轮缩放 · 右键平移
      </div>
    </div>
  )
}
