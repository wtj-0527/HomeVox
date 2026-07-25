import { Suspense, useEffect } from 'react'
import { Canvas, useThree, type RootState } from '@react-three/fiber'
import { Grid, Html, OrbitControls } from '@react-three/drei'
import type { BufferGeometry } from 'three'
import { buildWallShellPieces, frameWallShellModel, type WallShellModel } from './wallShell'

export type ThreeDRenderer = { state: RootState; generation: string }

type RendererLifecycleProps = {
  generation: string
  onMount: (renderer: ThreeDRenderer) => void
  onUnmount: (generation: string) => void
}

function RendererLifecycle({ generation, onMount, onUnmount }: RendererLifecycleProps) {
  const state = useThree()
  useEffect(() => {
    onMount({ state, generation })
    return () => onUnmount(generation)
  }, [generation, onMount, onUnmount, state])
  return null
}

export type ThreeDPreviewProps = {
  canonicalRevision: string | null
  model: WallShellModel
  wasmGeometry: BufferGeometry | null
  wasmActive: boolean
  webGLAvailable: boolean
  selectedWallID: string | null
  selectedOpeningID: string | null
  onSelectWall: (wallID: string) => void
  onSelectOpening: (openingID: string) => void
  onRendererMount: (renderer: ThreeDRenderer) => void
  onRendererUnmount: (generation: string) => void
}

function CanonicalScene({
  model,
  wasmGeometry,
  wasmActive,
  selectedWallID,
  selectedOpeningID,
  onSelectWall,
  onSelectOpening,
}: Omit<ThreeDPreviewProps, 'canonicalRevision' | 'webGLAvailable' | 'onRendererMount' | 'onRendererUnmount'>) {
  const pieces = buildWallShellPieces(model)
  return (
    <>
      <ambientLight intensity={0.72} />
      <directionalLight position={[10, 15, 10]} intensity={1.2} castShadow />
      {model.floor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[model.floor.x, 0, model.floor.z]} receiveShadow data-testid="wall-shell-floor">
          <planeGeometry args={[model.floor.width, model.floor.depth]} />
          <meshStandardMaterial color="#25344d" roughness={0.86} />
        </mesh>
      )}
      <Grid args={[18, 18]} cellSize={1} cellThickness={0.5} cellColor="#334155" sectionSize={5} sectionThickness={1} sectionColor="#64748b" fadeDistance={30} infiniteGrid />

      {/* Keep the generated WASM mesh in the mounted scene for a single
          canonical/WASM/renderer revision. Canonical pieces are the visible
          presentation because their explicit spans preserve opening cut-outs. */}
      {wasmActive && wasmGeometry && <mesh geometry={wasmGeometry} visible={false} data-testid="wasm-wall-mesh" />}

      {pieces.map((piece) => (
        <group key={piece.id}>
          <mesh
            position={[piece.x, piece.y, piece.z]}
            rotation={[0, piece.rotationY, 0]}
            castShadow
            receiveShadow
            onPointerDown={(event) => { event.stopPropagation(); onSelectWall(piece.wallId) }}
            onClick={(event) => { event.stopPropagation(); onSelectWall(piece.wallId) }}
          >
            <boxGeometry args={[piece.length, piece.height, piece.thickness]} />
            <meshStandardMaterial color="#dce7f4" roughness={0.68} />
          </mesh>
        </group>
      ))}
      {selectedWallID && model.walls.filter((wall) => wall.id === selectedWallID).map((wall) => (
        <group key={`wall-selection-${wall.id}`} position={[wall.x, wall.height + 0.12, wall.z]} rotation={[0, wall.rotationY, 0]}>
          <mesh data-testid={`three-wall-highlight-${wall.id}`}>
            <boxGeometry args={[Math.min(wall.length, 0.72), 0.09, wall.thickness + 0.08]} />
            <meshBasicMaterial color="#8b5cf6" toneMapped={false} />
          </mesh>
          <pointLight color="#a78bfa" intensity={2.2} distance={2.5} />
        </group>
      ))}

      {model.walls.map((wall) => (
        <Html key={`wall-picker-${wall.id}`} position={[wall.x, wall.height + 0.32, wall.z]} center>
          <button
            type="button"
            data-testid={`three-wall-${wall.id}`}
            aria-label={`3D 选择墙体 ${wall.id}`}
            aria-pressed={selectedWallID === wall.id}
            data-selected={selectedWallID === wall.id ? 'true' : 'false'}
            className={`h-4 w-4 rounded border border-white p-0 shadow ${selectedWallID === wall.id ? 'bg-violet-500' : 'bg-slate-950/45'}`}
            onClick={() => onSelectWall(wall.id)}
          />
        </Html>
      ))}

      {model.openings.map((opening) => {
        const isDoor = opening.kind === 'door'
        const markerHeight = isDoor ? 3.2 : 3.7
        return (
          <group key={opening.id}>
            <mesh
              data-testid={`three-opening-${opening.id}`}
              position={[opening.x, markerHeight, opening.z]}
              renderOrder={10}
              onPointerDown={(event) => { event.stopPropagation(); onSelectOpening(opening.id) }}
              onClick={(event) => { event.stopPropagation(); onSelectOpening(opening.id) }}
            >
              <sphereGeometry args={[isDoor ? 0.28 : 0.24, 20, 14]} />
              <meshBasicMaterial color={selectedOpeningID === opening.id ? '#7c3aed' : isDoor ? '#f97316' : '#38bdf8'} depthTest={false} toneMapped={false} />
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

export function ThreeDPreview(props: ThreeDPreviewProps) {
  const frame = frameWallShellModel(props.model)
  if (!props.webGLAvailable) {
    return <div className="flex h-full w-full items-center justify-center px-8 text-center" role="status" aria-label="3D 渲染不可用"><div className="max-w-sm rounded-2xl border border-amber-400/25 bg-amber-950/30 px-5 py-4 text-sm leading-6 text-amber-100">当前浏览器无法显示 3D 预览。请在启用 WebGL 的浏览器中打开；2D 校正仍可继续。</div></div>
  }
  return (
    <Canvas key={props.canonicalRevision ?? 'invalid'} className="absolute inset-0" camera={{ position: frame.position, fov: 38, near: 0.1, far: 100 }} shadows gl={{ antialias: true, preserveDrawingBuffer: true, alpha: false }} data-testid="three-render-surface">
      <color attach="background" args={['#111a2f']} />
      <RendererLifecycle generation={props.canonicalRevision ?? 'invalid'} onMount={props.onRendererMount} onUnmount={props.onRendererUnmount} />
      <Suspense fallback={null}>
        <CanonicalScene {...props} />
        <OrbitControls makeDefault target={frame.target} minDistance={frame.floorSpan * 0.65} maxDistance={frame.floorSpan * 2.4} />
      </Suspense>
    </Canvas>
  )
}
